"""Blender Action adapter for authored-time object clips (MIT).

Action metadata uses YAML clip, track, and object IDs. The export evaluator
restores the user's frame and Action assignments after sampling.
"""
import copy
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from . import animation

BASIS = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
CHANNELS = {'location': 3, 'rotation_quaternion': 4, 'rotation_euler': 3, 'rotation_axis_angle': 4, 'scale': 3}


def curves(action):
    """Handle legacy Actions and the single-slot layered Actions of Blender 4.5+."""
    if action is None:
        return []
    if not action.is_action_layered:
        return list(action.fcurves)
    if len(action.slots) != 1 or len(action.layers) != 1 or len(action.layers[0].strips) != 1:
        raise ValueError(f'{action.name}: multiple Action slots/layers/strips are unsupported')
    strip = action.layers[0].strips[0]
    bag = strip.channelbag(action.slots[0])
    return list(bag.fcurves) if bag else []


def assign(obj, action):
    """Assign a supported Action and its sole slot explicitly."""
    obj.animation_data_create().action = action
    if action and action.is_action_layered and len(action.slots) == 1:
        obj.animation_data.action_slot = action.slots[0]


def observation(action, obj):
    """Observe authored data rather than the current evaluated playback frame."""
    channels = curves(action)
    paths = {fc.data_path for fc in channels}
    return {'mode': obj.rotation_mode,
            'unkeyed': {p: list(getattr(obj, p)) for p in CHANNELS if p not in paths and
                        (not p.startswith('rotation_') or p == rotation_path(obj))},
            'curves': [{'path': fc.data_path, 'index': fc.array_index,
                        'extrapolation': fc.extrapolation, 'mute': fc.mute,
                        'keys': [[*kp.co, kp.interpolation, *kp.handle_left, *kp.handle_right,
                                  kp.handle_left_type, kp.handle_right_type, kp.easing,
                                  kp.amplitude, kp.back, kp.period] for kp in fc.keyframe_points]}
                       for fc in channels]}


def rotation_path(obj):
    return 'rotation_quaternion' if obj.rotation_mode == 'QUATERNION' else (
        'rotation_axis_angle' if obj.rotation_mode == 'AXIS_ANGLE' else 'rotation_euler')


def inspect_object(obj):
    """Reject evaluation dependencies that the first object-only adapter cannot carry."""
    data = obj.animation_data
    if obj.constraints or (data and (data.drivers or data.nla_tracks)):
        raise ValueError(f'{obj.name}: constraints, drivers and NLA are unsupported; export cancelled')
    if obj.rigid_body or obj.rigid_body_constraint:
        raise ValueError(f'{obj.name}: Blender rigid bodies are unsupported for animation export')
    if any(abs(v) > 1e-7 for v in obj.delta_location) or any(abs(v) > 1e-7 for v in obj.delta_rotation_euler) or list(obj.delta_rotation_quaternion) != [1, 0, 0, 0] or list(obj.delta_scale) != [1, 1, 1]:
        raise ValueError(f'{obj.name}: delta transforms are unsupported')
    blocks = [obj.data, getattr(obj.data, 'shape_keys', None)]
    blocks += list(getattr(obj.data, 'materials', []))
    blocks += [m.node_tree for m in getattr(obj.data, 'materials', []) if m and m.use_nodes]
    for block in blocks:
        if block and getattr(block, 'animation_data', None):
            raise ValueError(f'{obj.name}: data/shape-key/material animation is unsupported')


def inspect_action(action, obj):
    """Return actual authored times, rejecting channels that would be discarded."""
    result = set()
    for fc in curves(action):
        if fc.data_path not in CHANNELS or fc.array_index >= CHANNELS.get(fc.data_path, 0):
            raise ValueError(f'{obj.name}/{action.name}: unsupported animated channel {fc.data_path}')
        if fc.data_path.startswith('rotation_') and fc.data_path != rotation_path(obj):
            raise ValueError(f'{obj.name}: animated rotation channel does not match rotation mode')
        if fc.modifiers or fc.sampled_points or fc.mute or not fc.keyframe_points:
            raise ValueError(f'{obj.name}/{action.name}: modifiers, sampled, muted or empty F-Curves are unsupported')
        if any(k.interpolation not in ('LINEAR', 'BEZIER') for k in fc.keyframe_points):
            raise ValueError(f'{obj.name}/{action.name}: step/easing interpolation is unsupported')
        if fc.data_path == 'scale':
            values = [float(k.co.y) for k in fc.keyframe_points]
            if max(values)-min(values) > 1e-6 or any(k.interpolation != 'LINEAR' for k in fc.keyframe_points):
                raise ValueError(f'{obj.name}: animated scale is deferred; use constant LINEAR scale keys')
        result.update(float(k.co.x) for k in fc.keyframe_points)
    if not result or any(not math.isfinite(t) for t in result):
        raise ValueError(f'{obj.name}: Action needs finite authored key times')
    return sorted(result)


def import_clips(context, state, normalized, objects):
    """Create one editable Action per YAML track with stable source IDs."""
    origin = context.scene.frame_start
    fps = context.scene.render.fps / context.scene.render.fps_base
    first_actions = {}
    for clip in normalized:
        for track in clip['tracks']:
            obj = objects[track['target']['object']]
            action = bpy.data.actions.new(clip['id'] + '/' + track['id'])
            action.use_fake_user = True
            action['webg_scene_yaml_session'] = state['session']
            action['webg_clip_id'] = clip['id']
            action['webg_track_id'] = track['id']
            action['webg_object_id'] = obj['webg_id']
            assign(obj, action)
            previous = None
            for key, pose in zip(clip['keyframes'], track['poses']):
                frame = origin + key['time'] * fps
                obj.location = BASIS @ Vector(pose['position'])
                quat = (BASIS @ Quaternion(pose['quaternion']).to_matrix() @ BASIS.transposed()).to_quaternion()
                if previous is not None and previous.dot(quat) < 0:
                    quat.negate()
                obj.rotation_quaternion = quat
                previous = quat.copy()
                for path in ('location', 'rotation_quaternion'):
                    obj.keyframe_insert(data_path=path, frame=frame)
                if 'scale' in pose:
                    obj.scale = pose['scale']
                    obj.keyframe_insert(data_path='scale', frame=frame)
            for fc in curves(action):
                fc.extrapolation = 'CONSTANT'
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
            first_actions.setdefault(obj['webg_id'], action)
    for key, obj in objects.items():
        if key in first_actions:
            assign(obj, first_actions[key])
    context.scene.frame_set(context.scene.frame_current, subframe=context.scene.frame_subframe)


def local_pose(obj, depsgraph):
    """Convert an evaluated parent-local matrix and check its TRS reconstruction."""
    evaluated = obj.evaluated_get(depsgraph)
    matrix = evaluated.matrix_world.copy()
    if obj.parent:
        matrix = obj.parent.evaluated_get(depsgraph).matrix_world.inverted() @ matrix
    p, q, s = matrix.decompose()
    if any(v < 0 for v in obj.scale):
        raise ValueError(f'{obj.name}: negative scale is unsupported')
    # Matrix decomposition introduces float32 noise even for authored uniform scale.
    if min(s) <= 1e-8 or max(s)-min(s) > 2e-6 * max(s):
        raise ValueError(f'{obj.name}: only positive uniform scale is supported')
    rebuilt = Matrix.LocRotScale(p, q, s)
    if max(abs(matrix[i][j]-rebuilt[i][j]) for i in range(4) for j in range(4)) > 2e-5:
        raise ValueError(f'{obj.name}: local shear cannot be represented by TRS')
    q = (BASIS.transposed() @ q.to_matrix() @ BASIS).to_quaternion().normalized()
    return {'position': [round(v, 8) for v in BASIS.transposed() @ p],
            'quaternion': [round(v, 10) for v in q], 'scale': [float(s[0])] * 3}


def action_matches_source(action, obj, clip, track, scene, fps):
    """Compare a Blender Action directly with the keyframes in the YAML source."""
    if obj.rotation_mode != 'QUATERNION':
        return False
    channels = {(fc.data_path, fc.array_index): fc for fc in curves(action)}
    poses = track['poses']
    expected_paths = {'location', 'rotation_quaternion'}
    if 'scale' in poses[0]:
        expected_paths.add('scale')
    if {path for path, _ in channels} != expected_paths:
        return False
    for path, width in (('location', 3), ('scale', 3) if 'scale' in expected_paths else (None, 0)):
        if path is None:
            continue
        for index in range(width):
            curve = channels.get((path, index))
            if curve is None or curve.mute or curve.modifiers or len(curve.keyframe_points) != len(poses):
                return False
            for key_index, (key, pose) in enumerate(zip(clip['keyframes'], poses)):
                point = curve.keyframe_points[key_index]
                frame = scene.frame_start + key['time'] * fps
                if abs(point.co.x - frame) > 1e-4 or point.interpolation != 'LINEAR':
                    return False
                expected = list(BASIS @ Vector(pose['position']))[index] if path == 'location' else pose['scale'][index]
                if abs(point.co.y - expected) > 2e-5:
                    return False
    rotation_curves = [channels.get(('rotation_quaternion', index)) for index in range(4)]
    if any(curve is None or curve.mute or curve.modifiers or len(curve.keyframe_points) != len(poses) for curve in rotation_curves):
        return False
    for key_index, (key, pose) in enumerate(zip(clip['keyframes'], poses)):
        frame = scene.frame_start + key['time'] * fps
        if any(abs(curve.keyframe_points[key_index].co.x - frame) > 1e-4 or
               curve.keyframe_points[key_index].interpolation != 'LINEAR' for curve in rotation_curves):
            return False
        expected = (BASIS @ Quaternion(pose['quaternion']).to_matrix() @ BASIS.transposed()).to_quaternion()
        actual = [curve.keyframe_points[key_index].co.y for curve in rotation_curves]
        if abs(sum(a*b for a, b in zip(actual, expected))) < 1 - 2e-4:
            return False
    return True


def export_clips(context, state, base, objects, allow_approximation=False, source_items=None):
    """Export current Blender Actions by their YAML clip, track, and object IDs."""
    scene = context.scene
    fps = scene.render.fps / scene.render.fps_base
    origin = scene.frame_start
    source_items = source_items or {}
    source_clips = {clip['id']: clip for clip in base.get('animations', [])}
    records = []
    used_actions = set()
    for clip in base.get('animations', []):
        for track in clip['tracks']:
            object_id = track['target']['object']
            obj = objects[object_id]
            inspect_object(obj)
            action = obj.animation_data.action if obj.animation_data else None
            if action is None:
                raise ValueError(f'{object_id}: YAML track needs an assigned Blender Action')
            if action.get('webg_clip_id') != clip['id'] or action.get('webg_track_id') != track['id'] or action.get('webg_object_id') != object_id:
                raise ValueError(f'{obj.name}: Action IDs do not match YAML track {clip["id"]}/{track["id"]}')
            if action in used_actions:
                raise ValueError(f'{action.name}: one Action cannot represent multiple YAML tracks')
            used_actions.add(action)
            times = inspect_action(action, obj)
            changed = not action_matches_source(action, obj, clip, track, scene, fps)
            records.append({'clip': clip['id'], 'track': track['id'], 'object': object_id,
                            'obj': obj, 'action': action, 'times': times, 'changed': changed})
    for object_id, obj in objects.items():
        active = obj.animation_data.action if obj.animation_data else None
        if active is None or active in used_actions:
            continue
        inspect_object(obj)
        clip_id = active.get('webg_clip_id')
        track_id = active.get('webg_track_id')
        if base.get('format') != 'webg-scene' or not isinstance(clip_id, str) or not isinstance(track_id, str):
            raise ValueError(f'{obj.name}: assign YAML clip and track IDs before exporting a new Action')
        clip = source_clips.get(clip_id)
        track = next((value for value in clip.get('tracks', []) if value['id'] == track_id), None) if clip else None
        if track is not None:
            raise ValueError(f'{clip_id}/{track_id}: Action target must be the YAML object {track["target"]["object"]}')
        times = inspect_action(active, obj)
        records.append({'clip': clip_id, 'track': track_id, 'object': object_id,
                        'obj': obj, 'action': active, 'times': times, 'changed': True})
        used_actions.add(active)
    groups = {}
    actions = {}
    for index, record in enumerate(records):
        token = f'{record["clip"]}/{record["track"]}/{record["object"]}'
        if token in actions:
            raise ValueError(f'{token}: duplicate YAML animation identity')
        actions[token] = record['action']
        groups.setdefault(record['clip'], []).append((token, record, record['obj'], record['action'], record['times'], record['changed']))
    result = copy.deepcopy(base.get('animations', []))
    report = []
    saved = [(o, o.animation_data.action if o.animation_data else None,
              o.animation_data.action_slot if o.animation_data else None, o.matrix_basis.copy()) for o in objects.values()]
    frame, subframe = scene.frame_current, scene.frame_subframe
    try:
        for clip_id, tracks in groups.items():
            clip = next((value for value in result if value['id'] == clip_id), None)
            old = copy.deepcopy(clip)
            if clip is None:
                clip = {'id': clip_id, 'keyframes': [], 'tracks': []}
                result.append(clip)
            if old and not any(value[-1] for value in tracks):
                report.append(f'{clip_id}: {len(clip["keyframes"])} keys, {len(tracks)} tracks; source preserved')
                continue
            frames = sorted(set(frame for value in tracks for frame in value[4]))
            if len(frames) >= 1000:
                raise ValueError(f'{clip_id}: {len(frames)} common keys; this release requires fewer than 1000')
            if abs(frames[0]-origin) > 1e-4:
                raise ValueError(f'{clip_id}: first key must stay at retained origin frame {origin}')
            seconds = [(frame-origin)/fps for frame in frames]
            old_keys = old['keyframes'] if old else []
            old_frames = [origin + key['time'] * fps for key in old_keys]
            matches = [next((i for i, value in enumerate(old_frames) if abs(value-frame) < 1e-4), None) for frame in frames]
            if len(frames) == len(old_keys) and len(set(i for i in matches if i is not None)) < len(old_keys):
                if any(value[4] != frames for value in tracks):
                    raise ValueError(f'{clip_id}: retime all track channels together')
                matches = list(range(len(old_keys)))
            elif old_keys and not set(range(len(old_keys))) <= set(matches):
                raise ValueError(f'{clip_id}: key deletion/partial retiming requires source editing and reimport')
            keys = []
            for index, (time, match) in enumerate(zip(seconds, matches)):
                key = copy.deepcopy(old_keys[match]) if match is not None else {'id': f'key-{index:04d}'}
                key['time'] = round(time, 10)
                keys.append(key)
            clip['keyframes'] = keys
            for token, record, obj, action, times, changed in tracks:
                target = next((value for value in clip['tracks'] if value['id'] == record['track']), None)
                prior = copy.deepcopy(target)
                if target is None:
                    target = {'id': record['track'], 'target': {'object': record['object']},
                              'interpolation': {'position': 'linear', 'quaternion': 'slerp'}}
                    clip['tracks'].append(target)
                if not changed and prior:
                    target['poses'] = [copy.deepcopy(prior['poses'][match]) if match is not None else
                                       animation.sample(old_keys, prior['poses'], time)
                                       for time, match in zip(seconds, matches)]
                    continue
                approximate = any(any(k.interpolation == 'BEZIER' for k in fc.keyframe_points) for fc in curves(action))
                if approximate and not allow_approximation:
                    raise ValueError(f'{clip_id}/{record["track"]}: enable Allow curve approximation or use linear Blender keys')
                if approximate:
                    report.append(f'{clip_id}/{record["track"]}: authored-time curve approximation')
                assign(obj, action)
                poses = []
                for value in frames:
                    scene.frame_set(math.floor(value), subframe=value-math.floor(value))
                    poses.append(local_pose(obj, context.evaluated_depsgraph_get()))
                scale = poses[0]['scale']
                if any(any(abs(a-b) > 2e-5 for a, b in zip(pose['scale'], scale)) for pose in poses):
                    raise ValueError(f'{obj.name}: animated scale must remain constant')
                base_scale = source_items.get(obj['webg_id'], {}).get('transform', {}).get('scale', [1, 1, 1])
                for index, pose in enumerate(poses):
                    if (not prior or 'scale' not in prior['poses'][0]) and all(abs(a-b) < 2e-6 for a, b in zip(scale, base_scale)):
                        pose.pop('scale')
                    if prior and matches[index] is not None:
                        source_pose = prior['poses'][matches[index]]
                        if sum(a*b for a, b in zip(pose['quaternion'], source_pose['quaternion'])) < 0:
                            pose['quaternion'] = [-v for v in pose['quaternion']]
                        for field in list(pose):
                            if field in source_pose and all(abs(a-b) < 2e-6 for a, b in zip(pose[field], source_pose[field])):
                                pose[field] = copy.deepcopy(source_pose[field])
                target['poses'] = poses
            report.append(f'{clip_id}: {len(keys)} authored union keys, {len(tracks)} tracks; origin={origin}, fps={fps:g}')
    finally:
        for obj, action, slot, matrix in saved:
            if obj.animation_data or action:
                assign(obj, action)
                if action and slot:
                    obj.animation_data.action_slot = slot
            obj.matrix_basis = matrix
        scene.frame_set(frame, subframe=subframe)
    return result, {'origin': origin, 'fps': fps}, actions, report


def commit(state, info, actions, report):
    """Keep edited Actions available after a successful YAML save."""
    for action in actions.values():
        action.use_fake_user = True
    state['animation_report'] = report
