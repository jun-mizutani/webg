# Copyright (c) 2026 Jun Mizutani. Released under the MIT license.
"""Import and export SceneYAML, including gzip, with source comment retention.

The original document is stored in a Blender Text datablock. Object properties
carry stable IDs and editable physics values; the Text datablock owns comments,
formatting, renderer settings and fields that Blender does not display.
"""
import copy
import json
import math
import uuid
from pathlib import Path

import bpy
from bpy.props import BoolProperty, StringProperty
from bpy_extras.io_utils import ImportHelper, ExportHelper
from mathutils import Matrix, Vector

from .scene_yaml import Document, merge, read_text, save_text
from . import animation, blender_animation

bl_info = {
    'name': 'Webg SceneYAML I/O',
    'author': 'Jun Mizutani',
    'version': (0, 2, 0),
    'blender': (4, 5, 0),
    'location': 'File > Import/Export',
    'description': 'Round-trip Webg SceneYAML and .yaml.gz with source comments',
    'category': 'Import-Export',
}

# This basis maps webg (X, Y, Z) to Blender (X, -Z, Y).
# Conjugating rotations by the same basis keeps local axes and world poses aligned.
BASIS = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
SOURCE_KEY = 'webg_scene_yaml_source'
DOCUMENT_PREFIX = 'WebgSceneYAML_Document_'
STATE_PREFIX = 'WebgSceneYAML_State_'


def write_state(state_block, state):
    """Write add-on metadata as readable JSON in its dedicated Text block."""
    state_block.clear()
    state_block.write(json.dumps(state, ensure_ascii=False, indent=2))


def create_documents(context, state, document_text, material_text=None):
    """Store YAML source documents separately from internal JSON metadata.

    Keeping the source in raw Text blocks preserves comments, blank lines,
    line endings, quoting, and key order independently of JSON serialization.
    """
    session = state['session']
    document_block = bpy.data.texts.new(DOCUMENT_PREFIX + session)
    document_block.write(document_text)
    state['document_text_name'] = document_block.name
    if material_text is not None:
        material_block = bpy.data.texts.new(DOCUMENT_PREFIX + 'Materials_' + session)
        material_block.write(material_text)
        state['material_text_name'] = material_block.name
    else:
        material_block = None
    state.pop('text', None)
    state.pop('material_text', None)
    state_block = bpy.data.texts.new(STATE_PREFIX + session)
    write_state(state_block, state)
    context.scene[SOURCE_KEY] = state_block.name
    return state_block, document_block, material_block


def load_documents(context):
    """Load state metadata and raw YAML Text blocks for the active project.

    Older blend files stored YAML inside one JSON Text block. That layout is
    migrated to a raw YAML Text block when the project is exported.
    """
    state_name = context.scene.get(SOURCE_KEY, '')
    state_block = bpy.data.texts.get(state_name)
    if state_block is None:
        return None
    try:
        state = json.loads(state_block.as_string())
    except json.JSONDecodeError as error:
        raise ValueError(f'Webg SceneYAML state JSON is invalid: {error}') from error
    session = state.get('session')
    if not isinstance(session, str) or not session:
        raise ValueError('Webg SceneYAML state is missing session')
    migrated = False
    legacy_fields = ('objects', 'materials', 'material_bindings', 'animation', 'animation_report')
    for field in legacy_fields:
        if field in state:
            state.pop(field)
            migrated = True
    if not state.get('collection_name'):
        candidates = {collection.name for obj in bpy.data.objects
                      if obj.get('webg_session') == session
                      for collection in obj.users_collection}
        if len(candidates) != 1:
            raise ValueError('Webg SceneYAML state needs one imported object collection')
        state['collection_name'] = candidates.pop()
        migrated = True
    document_name = state.get('document_text_name')
    if document_name:
        document_block = bpy.data.texts.get(document_name)
        if document_block is None:
            raise ValueError(f'Webg SceneYAML document Text is unavailable: {document_name}')
    elif isinstance(state.get('text'), str):
        document_block = bpy.data.texts.new(DOCUMENT_PREFIX + session)
        document_block.write(state.pop('text'))
        state['document_text_name'] = document_block.name
        migrated = True
    else:
        raise ValueError('Webg SceneYAML state has no source document')
    material_block = None
    if state.get('material_path'):
        material_name = state.get('material_text_name')
        if material_name:
            material_block = bpy.data.texts.get(material_name)
            if material_block is None:
                raise ValueError(f'Webg SceneYAML material Text is unavailable: {material_name}')
        elif isinstance(state.get('material_text'), str):
            material_block = bpy.data.texts.new(DOCUMENT_PREFIX + 'Materials_' + session)
            material_block.write(state.pop('material_text'))
            state['material_text_name'] = material_block.name
            migrated = True
    state.pop('material_text', None)
    if migrated:
        write_state(state_block, state)
    return state_block, state, document_block, material_block


def combine(base, changes):
    """Merge objectSet overrides while retaining nested prototype properties."""
    result = copy.deepcopy(base)
    for key, value in changes.items():
        result[key] = combine(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else copy.deepcopy(value)
    return result


def expand_objects(project):
    """Expand grid instances in the same Y/Z/X order used by PrimitiveScene.js.

    Each generated entry retains its source set and index so an individual edit
    can be exported as an override instead of flattening the author's pattern.
    """
    result = [(copy.deepcopy(item), None, None) for item in project.get('objects', [])]
    for object_set in project.get('objectSets', []):
        placement = object_set['placement']
        if placement.get('type', 'grid3d') != 'grid3d':
            raise ValueError('SceneYAML import supports grid3d placement')
        count = placement.get('count', [1, 1, 1])
        if any(type(n) is not int or n < 1 for n in count) or math.prod(count) > 4096:
            raise ValueError('Object set count must contain positive integers, up to 4096 instances')
        variants = {v['id']: v for v in object_set.get('variants', [])}
        pattern = object_set.get('variantPattern', {})
        cycle = pattern.get('values', list(variants))
        if variants and pattern.get('type', 'cycle') != 'cycle':
            raise ValueError('Variant pattern must use cycle')
        overrides = {v['index']: v for v in object_set.get('overrides', [])}
        for y in range(count[1]):
            for z in range(count[2]):
                for x in range(count[0]):
                    index = (y * count[2] + z) * count[0] + x
                    source = variants[cycle[index % len(cycle)]] if variants else object_set['prototype']
                    item = copy.deepcopy(source)
                    transform = item.setdefault('transform', {})
                    original = transform.get('position', [0, 0, 0])
                    position = []
                    for axis, coordinate in enumerate((x, y, z)):
                        seed = placement.get('seed', 0) + index * 17 + axis * 31
                        raw = math.sin(seed * 91.3458 + 17.123) * 47453.5453
                        jitter = ((raw - math.floor(raw)) * 2 - 1) * placement.get('jitter', [0, 0, 0])[axis]
                        position.append(placement.get('origin', [0, 0, 0])[axis] + coordinate * placement.get('spacing', [0, 0, 0])[axis] + original[axis] + jitter)
                    transform['position'] = position
                    for section, fields in object_set.get('instancePattern', {}).items():
                        for field, rule in fields.items():
                            if rule['type'] == 'cycle':
                                value = rule['values'][index % len(rule['values'])]
                            elif rule['type'] == 'range':
                                value = rule['start'] + rule['step'] * index
                            else:
                                raise ValueError('Instance pattern must use cycle or range')
                            item.setdefault(section, {})[field] = copy.deepcopy(value)
                    item = combine(item, {k: v for k, v in overrides.get(index, {}).items() if k != 'index'})
                    item['id'] = f"{object_set['id']}_{index:03d}"
                    result.append((item, object_set['id'], index))
    ids = [entry[0]['id'] for entry in result]
    if len(set(ids)) != len(ids):
        raise ValueError('SceneYAML object IDs must be unique')
    return result


def rotation(value):
    """Convert webg degrees using Rz * Rx * Ry, matching Quat.eulerToQuat.

    The array is ordered by axis [X, Y, Z]; it is not Blender's default Euler
    composition order. Matrices avoid confusing those two independent rules.
    """
    if isinstance(value, dict):
        value = [value.get('pitch', 0), value.get('yaw', 0), value.get('roll', 0)]
    if len(value) != 3:
        raise ValueError('SceneYAML orientation requires three axis angles in degrees')
    x, y, z = map(math.radians, value)
    return Matrix.Rotation(z, 3, 'Z') @ Matrix.Rotation(x, 3, 'X') @ Matrix.Rotation(y, 3, 'Y')


def angles(matrix, original):
    """Recover webg Euler angles, choosing an equivalent branch near the source.

    At the pitch singularity we keep the original yaw and solve the remaining
    roll. Comparing matrices before calling this function preserves untouched
    angles and their original spelling exactly.
    """
    old = [original.get('pitch', 0), original.get('yaw', 0), original.get('roll', 0)] if isinstance(original, dict) else original
    pitch = math.asin(max(-1, min(1, matrix[2][1])))
    if abs(math.cos(pitch)) > 1e-6:
        yaw = math.atan2(-matrix[2][0], matrix[2][2])
        roll = math.atan2(-matrix[0][1], matrix[1][1])
    else:
        yaw = math.radians(old[1])
        roll = math.atan2(matrix[1][0], matrix[0][0]) - math.copysign(1, pitch) * yaw
    candidates = [(pitch, yaw, roll), (math.pi-pitch, yaw+math.pi, roll+math.pi)]
    adjusted = []
    for candidate in candidates:
        degrees = [math.degrees(a) for a in candidate]
        adjusted.append([a+360*round((b-a)/360) for a, b in zip(degrees, old)])
    value = min(adjusted, key=lambda v: sum((a-b)**2 for a, b in zip(v, old)))
    value = [round(a, 8) for a in value]
    if isinstance(original, dict):
        result = dict(original)
        for key, v in zip(('pitch', 'yaw', 'roll'), value):
            if key in result or abs(v) > 1e-7:
                result[key] = v
        return result
    return value


def geometry(shape):
    """Build local primitive geometry in webg axes before applying the basis.

    Capsule rings include both hemisphere equators. This produces the actual
    rounded capsule, so its preview dimensions agree with the webg collider.
    """
    kind = shape['type']
    if kind == 'box':
        sx, sy, sz = [n/2 for n in shape['size']]
        vertices = [(x*sx, y*sy, z*sz) for x, y, z in ((-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1))]
        faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]
    elif kind in ('sphere', 'capsule'):
        radius = shape['radius']
        half = shape.get('segmentLength', 0)/2 if kind == 'capsule' else 0
        rings = []
        for i in range(17):
            theta = math.pi * i/16
            rings.append((radius*math.sin(theta), radius*math.cos(theta)+(half if i <= 8 else -half)))
            if i == 8 and half:
                rings.append((radius, -half))
        vertices = [(r*math.cos(j*math.tau/32), h, r*math.sin(j*math.tau/32)) for r, h in rings for j in range(32)]
        faces = [(i*32+j, i*32+(j+1)%32, (i+1)*32+(j+1)%32, (i+1)*32+j) for i in range(len(rings)-1) for j in range(32)]
    else:
        raise ValueError(f'Unsupported primitive: {kind}')
    offset = Vector(shape.get('offset', [0, 0, 0]))
    return [BASIS @ (Vector(v)+offset) for v in vertices], faces


def mesh_signature(mesh):
    """Capture local geometry to detect edits that require mesh conversion."""
    return [[list(v.co) for v in mesh.vertices], [list(p.vertices) for p in mesh.polygons]]


def material_values(material):
    """Read only editable common PBR inputs; preserve other webg values in source."""
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    return {
        'color': list(bsdf.inputs['Base Color'].default_value),
        'metallic': float(bsdf.inputs['Metallic'].default_value),
        'roughness': float(bsdf.inputs['Roughness'].default_value),
        'specular': float(bsdf.inputs['Specular IOR Level'].default_value),
    }


def close(a, b, tolerance=2e-6):
    """Ignore Blender float32 storage noise when extracting user edits."""
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(close(x, y, tolerance) for x, y in zip(a, b))
    return abs(a-b) <= tolerance * max(1, abs(a), abs(b))


def source_entries(project):
    """Expand the YAML object declarations and index them by their stable IDs."""
    expanded = expand_objects(project)
    entries = {item['id']: (item, set_id, index) for item, set_id, index in expanded}
    if len(entries) != len(expanded):
        raise ValueError('SceneYAML object IDs must be unique')
    return entries


def source_matrix(item, webg_scene):
    """Build the source parent-local transform in Blender coordinates."""
    transform = item.get('transform', {})
    scale = transform.get('scale', [1, 1, 1]) if webg_scene else [1, 1, 1]
    position = BASIS @ Vector(transform.get('position', [0, 0, 0]))
    attitude = (BASIS @ rotation(transform.get('orientation', [0, 0, 0])) @ BASIS.transposed()).to_quaternion()
    return Matrix.LocRotScale(position, attitude, scale)


def primitive_box_from_mesh(obj):
    """Read a local axis-aligned Blender box as a webg box shape."""
    mesh = obj.data
    if len(mesh.vertices) != 8 or len(mesh.polygons) != 6 or any(len(p.vertices) != 4 for p in mesh.polygons):
        return None
    bounds = [(min(v.co[i] for v in mesh.vertices), max(v.co[i] for v in mesh.vertices)) for i in range(3)]
    expected = {(x, y, z) for x in bounds[0] for y in bounds[1] for z in bounds[2]}
    actual = {tuple(v.co) for v in mesh.vertices}
    if actual != expected or any(b-a <= 1e-8 for a, b in bounds):
        return None
    if any(not any(len({mesh.vertices[v].co[i] for v in p.vertices}) == 1 for i in range(3)) for p in mesh.polygons):
        return None
    size = [bounds[i][1]-bounds[i][0] for i in (0, 2, 1)]
    center = BASIS.transposed() @ Vector([(a+b)/2 for a, b in bounds])
    shape = {'type': 'box', 'size': size}
    if center.length > 1e-8:
        shape['offset'] = list(center)
    return shape


def object_shape(obj):
    """Read an explicitly supplied primitive shape or infer a Blender box."""
    raw = obj.get('webg_shape_json')
    if raw:
        try:
            shape = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError(f'{obj.name}: webg_shape_json is invalid: {error}') from error
        if not isinstance(shape, dict) or shape.get('type') not in ('box', 'sphere', 'capsule'):
            raise ValueError(f'{obj.name}: webg_shape_json needs a box, sphere or capsule shape')
        return shape
    shape = primitive_box_from_mesh(obj)
    if shape is None:
        raise ValueError(f'{obj.name}: assign webg_shape_json for a new non-box primitive')
    return shape


def current_transform(obj, webg_scene):
    """Read the current parent-local or scene transform in webg coordinates."""
    matrix = obj.matrix_local.copy() if webg_scene else obj.matrix_world.copy()
    location, quat, scale = matrix.decompose()
    if min(scale) <= 0:
        raise ValueError(f'{obj.name}: use a positive scale')
    rebuilt = Matrix.LocRotScale(location, quat, scale)
    if not close([list(r) for r in matrix], [list(r) for r in rebuilt]):
        raise ValueError(f'{obj.name}: shear requires mesh conversion')
    orientation = angles(BASIS.transposed() @ quat.to_matrix() @ BASIS, [0, 0, 0])
    return matrix, {
        'position': [round(v, 8) for v in BASIS.transposed() @ location],
        'orientation': orientation,
        'scale': [round(float(v), 8) for v in scale],
    }


def scale_shape(shape, blender_scale, label):
    """Bake Blender local scale into a webg primitive shape."""
    sx, sy, sz = blender_scale.x, blender_scale.z, blender_scale.y
    result = copy.deepcopy(shape)
    if result['type'] == 'box':
        result['size'] = [round(value * factor, 8) for value, factor in zip(result['size'], (sx, sy, sz))]
    elif close([sx, sy, sz], [sx, sx, sx]):
        result['radius'] *= sx
        if 'segmentLength' in result:
            result['segmentLength'] *= sx
    else:
        raise ValueError(f'{label}: sphere/capsule dimensions require uniform scale')
    if 'offset' in result:
        result['offset'] = [value * factor for value, factor in zip(result['offset'], (sx, sy, sz))]
    return result


def current_physics(obj):
    """Read the editable physics JSON attached to an imported or new object."""
    raw = obj.get('webg_physics_json', 'null')
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f'{obj.name}: webg_physics_json is invalid: {error}') from error
    if value is not None and not isinstance(value, dict):
        raise ValueError(f'{obj.name}: webg_physics_json must contain an object or null')
    return value


def current_material(obj):
    """Read the PBR values from the active Principled material."""
    material = obj.active_material
    if material is None or not material.use_nodes or not material.node_tree.nodes.get('Principled BSDF'):
        raise ValueError(f'{obj.name}: assign a Principled material')
    return material, material_values(material)


def new_object_item(obj, source_ids, material_ids, webg_scene):
    """Create one YAML object declaration from an explicitly identified Blender object."""
    object_id = obj.get('webg_id')
    if not isinstance(object_id, str) or not object_id:
        raise ValueError(f'{obj.name}: set a unique webg_id before exporting a new object')
    explicit_shape = bool(obj.get('webg_shape_json'))
    shape = object_shape(obj)
    vertices, faces = geometry(shape)
    if obj.modifiers or (explicit_shape and not close(mesh_signature(obj.data), [vertices, faces])):
        raise ValueError(f'{obj.name}: Blender mesh does not match webg_shape_json')
    _, transform = current_transform(obj, webg_scene)
    if not webg_scene:
        shape = scale_shape(shape, Vector(transform['scale']), obj.name + '/shape')
        transform.pop('scale', None)
    material, values = current_material(obj)
    material_id = material.get('webg_material_id')
    item = {'id': object_id, 'shape': shape, 'transform': transform}
    parent = obj.parent.get('webg_id') if obj.parent else None
    if obj.parent and parent not in source_ids:
        raise ValueError(f'{obj.name}: parent must be in the exported SceneYAML collection')
    if parent:
        item['parent'] = parent
    if isinstance(material_id, str) and material_id in material_ids:
        item['material'] = material_id
    else:
        item['material'] = values
    physics = current_physics(obj)
    if physics is not None:
        item['physics'] = physics
    return item


def import_project(context, filepath):
    """Create Blender objects while keeping the original YAML as the source."""
    filepath = str(Path(filepath).resolve())
    text = read_text(filepath)
    project = Document(text).data
    entries = expand_objects(project)
    normalized = animation.validate(project, entries)
    if any('shape' not in entry[0] for entry in entries):
        raise ValueError('This release imports primitive objects/objectSets; mesh asset import is the next stage')
    material_path = str((Path(filepath).parent / project['materialsUrl']).resolve()) if 'materialsUrl' in project else None
    material_text = read_text(material_path) if material_path else None
    definitions = copy.deepcopy(Document(material_text).data if material_text else project.get('materials', []))
    material_ids = {d['id'] for d in definitions}
    for item, _, _ in entries:
        reference = item.get('material')
        if isinstance(reference, str):
            if reference not in material_ids:
                raise ValueError(f'{item["id"]}: unknown material {reference}')
        else:
            definitions.append({'id': '__inline_' + item['id'], **(reference or {})})
    session = uuid.uuid4().hex
    collection = bpy.data.collections.new(Path(filepath).name)
    collection['webg_scene_yaml_session'] = session
    context.scene.collection.children.link(collection)
    created_materials = []
    state = {'path': filepath, 'session': session, 'material_path': material_path,
             'collection_name': collection.name}
    try:
        materials = {}
        objects = {}
        for definition in definitions:
            material = bpy.data.materials.new(definition['id'])
            created_materials.append(material)
            material.use_nodes = True
            bsdf = material.node_tree.nodes.get('Principled BSDF')
            for key, socket in (('color', 'Base Color'), ('metallic', 'Metallic'), ('roughness', 'Roughness'), ('specular', 'Specular IOR Level')):
                if key in definition:
                    bsdf.inputs[socket].default_value = definition[key]
            material['webg_material_id'] = definition['id']
            material['webg_scene_yaml_session'] = session
            materials[definition['id']] = material
        for item, _, _ in entries:
            vertices, faces = geometry(item['shape'])
            mesh = bpy.data.meshes.new(item['id'])
            mesh.from_pydata(vertices, [], faces)
            mesh.update()
            obj = bpy.data.objects.new(item['id'], mesh)
            collection.objects.link(obj)
            transform = item.get('transform', {})
            obj.location = BASIS @ Vector(transform.get('position', [0, 0, 0]))
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = (BASIS @ rotation(transform.get('orientation', [0, 0, 0])) @ BASIS.transposed()).to_quaternion()
            obj.scale = transform.get('scale', [1, 1, 1])
            material_id = item.get('material') if isinstance(item.get('material'), str) else '__inline_' + item['id']
            mesh.materials.append(materials[material_id])
            obj['webg_id'] = item['id']
            obj['webg_session'] = session
            obj['webg_physics_json'] = json.dumps(item.get('physics'), ensure_ascii=False)
            obj['webg_shape_json'] = json.dumps(item['shape'], ensure_ascii=False)
            objects[item['id']] = obj
        for item, _, _ in entries:
            obj = objects[item['id']]
            if item.get('parent'):
                obj.parent = objects[item['parent']]
                obj.matrix_parent_inverse.identity()
        context.view_layer.update()
        blender_animation.import_clips(context, state, normalized, objects)
        create_documents(context, state, text, material_text)
        state['object_count'] = len(objects)
        return state
    except Exception:
        for obj in list(collection.objects):
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(collection)
        for material in created_materials:
            bpy.data.materials.remove(material)
        raise


def prepare_fresh_project(context):
    """Create a source document from explicitly identified Blender boxes."""
    objects = [obj for obj in context.scene.objects if obj.type == 'MESH']
    if not objects:
        raise ValueError('Fresh export requires at least one mesh object')
    ids = [obj.get('webg_id') for obj in objects]
    if any(not isinstance(key, str) or not key for key in ids) or len(set(ids)) != len(ids):
        raise ValueError('Fresh export requires unique webg_id properties')
    project = {'format': 'webg-scene', 'version': 1, 'name': context.scene.name, 'objects': []}
    session = uuid.uuid4().hex
    collection = bpy.data.collections.new('WebgSceneYAML_Fresh_' + session)
    context.scene.collection.children.link(collection)
    collection['webg_scene_yaml_session'] = session
    for obj in objects:
        collection.objects.link(obj)
    state = {'path': None, 'session': session, 'material_path': None,
             'collection_name': collection.name}
    source_ids = set(ids)
    for obj, object_id in zip(objects, ids):
        blender_animation.inspect_object(obj)
        shape = primitive_box_from_mesh(obj)
        if shape is None or obj.modifiers:
            raise ValueError(f'{obj.name}: fresh export currently supports unmodified box primitives')
        _, transform = current_transform(obj, True)
        parent = obj.parent.get('webg_id') if obj.parent else None
        if obj.parent and parent not in source_ids:
            raise ValueError(f'{obj.name}: parent must be an exported box')
        material, values = current_material(obj)
        item = {'id': object_id, 'shape': shape, 'transform': transform, 'material': values}
        if parent:
            item['parent'] = parent
        project['objects'].append(item)
        obj['webg_session'] = session
        obj['webg_physics_json'] = 'null'
        obj['webg_shape_json'] = json.dumps(shape, ensure_ascii=False)
        material['webg_material_id'] = '__inline_' + object_id
        material['webg_scene_yaml_session'] = session
    animation.validate(project, expand_objects(project))
    document_text = '# SceneYAML primitive scene exported from Blender\n' + ''.join(
        key + ': ' + json.dumps(value, ensure_ascii=False) + '\n' for key, value in project.items())
    state_block, _, _ = create_documents(context, state, document_text)
    return state_block


def export_project(context, filepath, allow_approximation=False):
    """Export current Blender values into the source YAML with minimal patches."""
    documents = load_documents(context)
    if documents is None:
        prepare_fresh_project(context)
        documents = load_documents(context)
    state_block, state, document_block, material_block = documents
    base = Document(document_block.as_string()).data
    entries = source_entries(base)
    webg_scene = base.get('format') == 'webg-scene'
    collection = bpy.data.collections.get(state.get('collection_name', ''))
    if collection is None:
        raise ValueError('The imported SceneYAML collection is unavailable')
    objects = {}
    for obj in collection.all_objects:
        if obj.type != 'MESH':
            continue
        key = obj.get('webg_id')
        if not isinstance(key, str) or not key:
            raise ValueError(f'{obj.name}: set a unique webg_id before exporting a new object')
        if key in objects:
            raise ValueError(f'Duplicate object ID: {key}; assign a distinct source object before export')
        objects[key] = obj
    missing = set(entries) - set(objects)
    if missing:
        raise ValueError(f'Object removal requires explicit YAML editing and reimport: {sorted(missing)}')
    material_base = Document(material_block.as_string()).data if material_block else base.get('materials', [])
    material_ids = {item['id'] for item in material_base}
    edited = copy.deepcopy(base)
    animated_clips, animation_info, actions, report = blender_animation.export_clips(
        context, state, base, objects, allow_approximation, {key: value[0] for key, value in entries.items()})
    if animated_clips or 'animations' in base:
        edited['animations'] = animated_clips
    animated = {track['target']['object'] for clip in animated_clips for track in clip['tracks']}
    material_edit = copy.deepcopy(material_base)
    bake_scales = []

    def apply_changes(key, item, set_id, index, changes):
        if not changes:
            return
        if set_id is None:
            target = next(value for value in edited.get('objects', []) if value['id'] == key)
            target.update(combine(target, changes))
        else:
            target = next(value for value in edited.get('objectSets', []) if value['id'] == set_id)
            overrides = target.setdefault('overrides', [])
            existing = next((value for value in overrides if value['index'] == index), None)
            if existing is None:
                overrides.append({'index': index, **changes})
            else:
                existing.update(combine(existing, changes))

    for key, (item, set_id, index) in entries.items():
        obj = objects[key]
        expected_vertices, expected_faces = geometry(item['shape'])
        expected_geometry = [expected_vertices, expected_faces]
        if obj.modifiers or not close(mesh_signature(obj.data), expected_geometry):
            raise ValueError(f'{key}: local mesh edits require the mesh conversion stage')
        parent_id = obj.parent.get('webg_id') if obj.parent else None
        if parent_id != item.get('parent'):
            raise ValueError(f'{key}: parent changes require YAML editing and reimport')
        current_matrix, current = current_transform(obj, webg_scene)
        source = source_matrix(item, webg_scene)
        if key in animated:
            current_matrix = source
            current = copy.deepcopy(item.get('transform', {}))
            current.setdefault('position', [0, 0, 0])
            current.setdefault('orientation', [0, 0, 0])
            current.setdefault('scale', list(source.decompose()[2]))
        source_location, source_quat, source_scale = source.decompose()
        current_location, current_quat, current_scale = current_matrix.decompose()
        changes = {}
        if not close(list(current_location), list(source_location)):
            changes.setdefault('transform', {})['position'] = current['position']
        if not close([list(r) for r in current_quat.to_matrix()], [list(r) for r in source_quat.to_matrix()]):
            changes.setdefault('transform', {})['orientation'] = current['orientation']
        if webg_scene:
            animation.uniform_scale(list(current_scale), key + '/transform.scale')
            if not close(list(current_scale), list(source_scale)):
                changes.setdefault('transform', {})['scale'] = current['scale']
        else:
            relative = Vector([a/b for a, b in zip(current_scale, source_scale)])
            if not close(list(relative), [1, 1, 1]):
                changes['shape'] = scale_shape(item['shape'], current_scale, key + '/shape')
                bake_scales.append((obj, current_scale.copy()))
        physics = current_physics(obj)
        if physics != item.get('physics'):
            if physics is None:
                changes['physics'] = None
            else:
                changes['physics'] = physics
        material, values = current_material(obj)
        material_id = material.get('webg_material_id')
        if isinstance(item.get('material'), str):
            if material_id != item['material']:
                changes['material'] = material_id if material_id in material_ids else values
            elif material_id in material_ids:
                target = next(value for value in material_edit if value['id'] == material_id)
                for field, value in values.items():
                    if field not in target or not close(target[field], value):
                        target[field] = value
        elif not close(item.get('material') or {}, values):
            changes['material'] = values
        apply_changes(key, item, set_id, index, changes)

    for key in set(objects) - set(entries):
        obj = objects[key]
        item = new_object_item(obj, set(objects), material_ids, webg_scene)
        edited.setdefault('objects', []).append(item)

    if state.get('material_path'):
        if material_edit != material_base:
            material_path = Path(state['material_path'])
            material_source = read_text(material_path)
            material_disk = Document(material_source)
            material_merged = merge(material_base, material_disk.data, material_edit)
            material_candidate = material_disk.update(material_merged)
            save_text(material_path, material_candidate, material_path.read_bytes())
            material_block.clear()
            material_block.write(material_candidate)
    elif material_edit or 'materials' in base:
        edited['materials'] = material_edit

    output = Path(filepath).resolve()
    original_path = Path(state['path']) if state.get('path') else output
    original_bytes = original_path.read_bytes() if state.get('path') else None
    disk_text = read_text(original_path) if state.get('path') else document_block.as_string()
    disk = Document(disk_text)
    merged = merge(base, disk.data, edited)
    animation.validate(merged, expand_objects(merged))
    candidate = disk.update(merged)
    expected = original_bytes if output == original_path else (output.read_bytes() if output.exists() else None)
    if output != original_path and output.exists() and read_text(output) != candidate:
        raise ValueError('Save As target already exists; choose a new filename')
    save_text(output, candidate, expected)
    for obj, scale in bake_scales:
        for vertex in obj.data.vertices:
            vertex.co.x *= scale.x
            vertex.co.y *= scale.y
            vertex.co.z *= scale.z
        obj.scale = (1, 1, 1)
        obj.data.update()
    state['path'] = str(output)
    document_block.clear()
    document_block.write(candidate)
    write_state(state_block, state)
    return candidate


class ImportSceneYAML(bpy.types.Operator, ImportHelper):
    """Read SceneYAML and retain its source comments inside the .blend file."""
    bl_idname = 'import_scene.webg_scene_yaml'
    bl_label = 'Import Webg SceneYAML'
    bl_options = {'UNDO'}
    filename_ext = '.yaml'
    filter_glob: StringProperty(default='*.yaml;*.yml;*.yaml.gz;*.yml.gz', options={'HIDDEN'})

    def execute(self, context):
        try:
            state = import_project(context, self.filepath)
            self.report({'INFO'}, f"Imported {state.get('object_count', 0)} Webg objects; source comments retained")
            return {'FINISHED'}
        except Exception as error:
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}


class ExportSceneYAML(bpy.types.Operator, ExportHelper):
    """Export plain .yaml/.yml or gzip .yaml.gz/.yml.gz based on the filename."""
    bl_idname = 'export_scene.webg_scene_yaml'
    bl_label = 'Export Webg SceneYAML'
    filename_ext = ''
    filter_glob: StringProperty(default='*.yaml;*.yml;*.yaml.gz;*.yml.gz', options={'HIDDEN'})
    allow_approximation: BoolProperty(name='Allow curve approximation', default=False,
        description='Sample authored times; intermediate Blender curves and long rotations may differ from LERP/SLERP')

    def execute(self, context):
        try:
            if not self.filepath.lower().endswith(('.yaml', '.yml', '.yaml.gz', '.yml.gz')):
                raise ValueError('Choose .yaml, .yml, .yaml.gz or .yml.gz')
            export_project(context, self.filepath, self.allow_approximation)
            self.report({'INFO'}, 'Exported SceneYAML with original comments')
            return {'FINISHED'}
        except Exception as error:
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}


def menu_import(self, context):
    """Expose plain and compressed import through one file selector."""
    self.layout.operator(ImportSceneYAML.bl_idname, text='Webg SceneYAML (.yaml / .yaml.gz)')


def menu_export(self, context):
    """Let the output extension choose gzip without changing document semantics."""
    self.layout.operator(ExportSceneYAML.bl_idname, text='Webg SceneYAML (.yaml / .yaml.gz)')


def register():
    """Register operators and menus when Blender enables this add-on."""
    for cls in (ImportSceneYAML, ExportSceneYAML):
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_import.append(menu_import)
    bpy.types.TOPBAR_MT_file_export.append(menu_export)


def unregister():
    """Remove only menus and operators owned by this add-on."""
    bpy.types.TOPBAR_MT_file_export.remove(menu_export)
    bpy.types.TOPBAR_MT_file_import.remove(menu_import)
    for cls in (ExportSceneYAML, ImportSceneYAML):
        bpy.utils.unregister_class(cls)
