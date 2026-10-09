"""SceneYAML object animation validation and interpolation, without Blender (MIT)."""
import copy
import math

QUATERNION_TOLERANCE = 1e-4


def vector(value, length, label):
    """Reject booleans, strings and non-finite components before conversion."""
    if not isinstance(value, list) or len(value) != length or any(
            type(v) not in (int, float) or not math.isfinite(v) for v in value):
        raise ValueError(f'{label}: expected {length} finite numbers')
    return value


def uniform_scale(value, label):
    """The first animation contract accepts only positive uniform scale."""
    vector(value, 3, label)
    if min(value) <= 1e-8 or max(value) - min(value) > 1e-8:
        raise ValueError(f'{label}: only positive uniform scale is supported')
    return value


def unit_quaternion(value, label):
    vector(value, 4, label)
    norm = math.sqrt(sum(v*v for v in value))
    if norm == 0 or abs(norm - 1) > QUATERNION_TOLERANCE:
        raise ValueError(f'{label}: quaternion norm must be within {QUATERNION_TOLERANCE} of one')
    return [v / norm for v in value]


def identifiers(items, label):
    if not isinstance(items, list):
        raise ValueError(f'{label}: expected an array')
    result = set()
    for item in items:
        key = item.get('id') if isinstance(item, dict) else None
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f'{label}: missing or duplicate stable ID {key!r}')
        result.add(key)
    return result


def validate(project, entries):
    """Validate references and return a normalized copy without changing raw values."""
    clips = project.get('animations', [])
    if 'animations' in project and project.get('format') != 'webg-scene':
        raise ValueError('animations require format: webg-scene (version: 1)')
    objects = {item['id']: item for item, _, _ in entries}
    if project.get('format') == 'webg-scene':
        if type(project.get('version', 1)) is not int or project.get('version', 1) != 1:
            raise ValueError('webg-scene requires version: 1')
        for key, obj in objects.items():
            uniform_scale(obj.get('transform', {}).get('scale', [1, 1, 1]), f'{key}/transform.scale')
            visited = {key}
            parent = obj.get('parent')
            while parent is not None:
                if parent not in objects or parent in visited:
                    raise ValueError(f'{key}: missing parent or parent cycle: {parent}')
                visited.add(parent)
                parent = objects[parent].get('parent')
    elif any('parent' in obj or 'scale' in obj.get('transform', {}) for obj in objects.values()):
        raise ValueError('parent/transform.scale require format: webg-scene')
    identifiers(clips, 'animations')
    normalized = copy.deepcopy(clips)
    for clip in normalized:
        label = clip['id']
        keys = clip.get('keyframes')
        identifiers(keys, f'{label}/keyframes')
        if not keys:
            raise ValueError(f'{label}: at least one keyframe is required')
        previous = -1
        for i, key in enumerate(keys):
            t = key.get('time')
            if type(t) not in (int, float) or not math.isfinite(t) or t <= previous or (i == 0 and t != 0):
                raise ValueError(f'{label}/{key["id"]}: times must start at zero and strictly increase')
            previous = t
        tracks = clip.get('tracks')
        identifiers(tracks, f'{label}/tracks')
        if not tracks:
            raise ValueError(f'{label}: at least one track is required')
        targets = set()
        for track in tracks:
            where = f'{label}/{track["id"]}'
            target = track.get('target')
            if not isinstance(target, dict) or set(target) != {'object'}:
                raise ValueError(f'{where}: only object targets are supported; joint animation is deferred')
            target = target['object']
            if not isinstance(target, str) or target not in objects or target in targets:
                raise ValueError(f'{where}: missing or duplicate object target {target!r}')
            targets.add(target)
            for obj in objects.values():
                if obj.get('physics') is None:
                    continue
                ancestor = obj['id']
                while ancestor is not None:
                    if ancestor == target:
                        raise ValueError(f'{where}: animated target/ancestor of physical body {obj["id"]}; kinematic integration is deferred')
                    ancestor = objects[ancestor].get('parent')
            interpolation = track.get('interpolation', {})
            if not isinstance(interpolation, dict) or any(
                    k not in ('position', 'quaternion', 'scale') or v != ('slerp' if k == 'quaternion' else 'linear')
                    for k, v in interpolation.items()):
                raise ValueError(f'{where}: unsupported interpolation; use linear position and slerp quaternion')
            poses = track.get('poses')
            if not isinstance(poses, list) or len(poses) != len(keys):
                raise ValueError(f'{where}: pose count must equal common key count')
            has_scale = ['scale' in p for p in poses if isinstance(p, dict)]
            if len(has_scale) != len(poses) or (any(has_scale) and not all(has_scale)):
                raise ValueError(f'{where}: scale must be present in every pose or omitted throughout')
            first_scale = None
            for key, pose in zip(keys, poses):
                location = f'{where}/{key["id"]}'
                if set(pose) - {'position', 'quaternion', 'scale'}:
                    raise ValueError(f'{location}: unsupported pose fields')
                vector(pose.get('position'), 3, location + '/position')
                pose['quaternion'] = unit_quaternion(pose.get('quaternion'), location)
                if 'scale' in pose:
                    scale = uniform_scale(pose['scale'], location + '/scale')
                    if first_scale is not None and any(abs(a-b) > 1e-8 for a, b in zip(scale, first_scale)):
                        raise ValueError(f'{location}: animated scale is deferred; scale must be constant')
                    first_scale = scale
    return normalized


def sample(keys, poses, seconds):
    """Evaluate absolute local poses using clamped LERP and shortest-path SLERP."""
    if seconds <= keys[0]['time']:
        return copy.deepcopy(poses[0])
    if seconds >= keys[-1]['time']:
        return copy.deepcopy(poses[-1])
    i = next(i for i in range(len(keys)-1) if keys[i+1]['time'] >= seconds)
    u = (seconds - keys[i]['time']) / (keys[i+1]['time'] - keys[i]['time'])
    a, b = poses[i], poses[i+1]
    q0 = unit_quaternion(a['quaternion'], 'sample')
    q1 = unit_quaternion(b['quaternion'], 'sample')
    dot = sum(x*y for x, y in zip(q0, q1))
    if dot < 0:
        q1, dot = [-x for x in q1], -dot
    if dot > 0.9995:
        q = [(1-u)*x + u*y for x, y in zip(q0, q1)]
    else:
        angle = math.acos(max(-1, min(1, dot)))
        q = [(math.sin((1-u)*angle)*x + math.sin(u*angle)*y) / math.sin(angle) for x, y in zip(q0, q1)]
    norm = math.sqrt(sum(x*x for x in q))
    result = {'position': [(1-u)*x+u*y for x, y in zip(a['position'], b['position'])],
              'quaternion': [x/norm for x in q]}
    if 'scale' in a:
        result['scale'] = list(a['scale'])
    return result
