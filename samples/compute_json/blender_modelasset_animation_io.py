# ---------------------------------------------
# samples/compute_json/blender_modelasset_animation_io.py  2026/06/20
#   Blender import/export add-on for animated ModelAsset JSON
#   Copyright (c) 2026 Jun Mizutani,
#   released under the MIT open source license.
# ---------------------------------------------
bl_info = {
    "name": "Webg Animated ModelAsset JSON I/O",
    "author": "Jun Mizutani",
    "version": (0, 3, 0),
    "blender": (3, 6, 0),
    "location": "File > Import/Export",
    "description": "Import and export webg ModelAsset JSON with skeletons and animations",
    "category": "Import-Export",
}

import json
import gzip
import math
import os
import re

import bpy
from mathutils import Matrix, Vector
from bpy_extras.io_utils import ExportHelper, ImportHelper
from bpy.props import BoolProperty, StringProperty


MODEL_ASSET_TYPE = "webg-model-asset"
DEFAULT_MATERIAL_ID = "modelasset_mat"
INFLUENCES_PER_VERTEX = 4
MAX_EXPORTED_BONES = 320


def is_gzip_modelasset_path(filepath):
    return str(filepath or "").lower().endswith(".json.gz")


def load_modelasset_json(filepath):
    if is_gzip_modelasset_path(filepath):
        with gzip.open(filepath, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    with open(filepath, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_modelasset_json(filepath, data):
    if is_gzip_modelasset_path(filepath):
        with gzip.open(filepath, "wt", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        return
    with open(filepath, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def resolve_export_filepath(filepath, use_gzip):
    path = str(filepath or "").strip()
    if not path:
        raise ValueError("Export filepath is empty")

    directory = os.path.dirname(path)
    filename = os.path.basename(path)
    lower_name = filename.lower()
    while lower_name.endswith(".json.gz"):
        filename = filename[:-8]
        lower_name = filename.lower()
    while lower_name.endswith(".json"):
        filename = filename[:-5]
        lower_name = filename.lower()
    if not filename:
        filename = "modelasset"
    stem = os.path.join(directory, filename) if directory else filename
    if use_gzip:
        return stem + ".json.gz"
    return stem + ".json"


def export_filename_ext(use_gzip):
    return ".json.gz" if use_gzip else ".json"


def safe_id(value, fallback):
    text = str(value or "").strip()
    return text if text else fallback


def finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a finite number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number


def read_index(value, label, vertex_count):
    number = finite_number(value, label)
    if int(number) != number:
        raise ValueError(f"{label} must be an integer vertex index")
    vertex_index = int(number)
    if vertex_index < 0 or vertex_index >= vertex_count:
        raise ValueError(f"{label} references vertex {vertex_index} outside 0..{vertex_count - 1}")
    return vertex_index


def webg_to_blender_position(point, convert_axes=True):
    x, y, z = point
    if not convert_axes:
        return (x, y, z)
    return (x, -z, y)


def blender_to_webg_position(point, convert_axes=True):
    x, y, z = point
    if not convert_axes:
        return (x, y, z)
    return (x, z, -y)


# ModelAssetの4x4配列はcolumn-major、Blender Matrixはrow/column添字で扱う
# 配列化と復元をこの2関数へ集約し、bind matrixとanimation poseで転置規則がずれないようにする
def matrix_to_col_major(matrix):
    return [round(float(matrix[row][column]), 8) for column in range(4) for row in range(4)]


def matrix_from_col_major(values, label):
    if not isinstance(values, list) or len(values) < 16:
        raise ValueError(f"{label} must contain 16 matrix values")
    checked = [finite_number(values[index], f"{label}[{index}]") for index in range(16)]
    return Matrix(tuple(
        tuple(checked[column * 4 + row] for column in range(4))
        for row in range(4)
    ))


# Blender Z-upからModelAsset Y-upへの基底変換行列を返す
# position変換(x,y,z)->(x,z,-y)と同じ規則をmatrix全体へ適用する
def blender_to_webg_basis():
    return Matrix((
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, -1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))


def blender_to_webg_matrix(matrix, convert_axes=True):
    if not convert_axes:
        return matrix.copy()
    basis = blender_to_webg_basis()
    return basis @ matrix @ basis.inverted()


def webg_to_blender_matrix(matrix, convert_axes=True):
    if not convert_axes:
        return matrix.copy()
    basis = blender_to_webg_basis()
    return basis.inverted() @ matrix @ basis


def read_positions(geometry):
    positions = geometry.get("positions")
    if not isinstance(positions, list) or len(positions) % 3 != 0:
        raise ValueError("geometry.positions must be a number array whose length is a multiple of 3")
    vertices = []
    for index in range(0, len(positions), 3):
        vertices.append((
            finite_number(positions[index], f"positions[{index}]"),
            finite_number(positions[index + 1], f"positions[{index + 1}]"),
            finite_number(positions[index + 2], f"positions[{index + 2}]"),
        ))
    return vertices


def read_faces(geometry, vertex_count):
    loops = geometry.get("polygonLoops")
    if isinstance(loops, list) and loops:
        faces = []
        for loop_index, loop in enumerate(loops):
            if not isinstance(loop, list) or len(loop) < 3:
                raise ValueError(f"polygonLoops[{loop_index}] must contain at least 3 vertex indices")
            face = []
            for item_index, value in enumerate(loop):
                face.append(read_index(value, f"polygonLoops[{loop_index}][{item_index}]", vertex_count))
            faces.append(face)
        return faces

    indices = geometry.get("indices")
    if not isinstance(indices, list) or len(indices) % 3 != 0:
        raise ValueError("geometry.indices must be a number array whose length is a multiple of 3")
    faces = []
    for index in range(0, len(indices), 3):
        face = []
        for item_index, value in enumerate(indices[index:index + 3]):
            face.append(read_index(value, f"indices[{index + item_index}]", vertex_count))
        faces.append(face)
    return faces


def identity_col_major_matrix():
    return [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]


def multiply_col_major_matrix(a, b):
    result = [0.0] * 16
    for column in range(4):
        for row in range(4):
            result[column * 4 + row] = sum(
                a[k * 4 + row] * b[column * 4 + k]
                for k in range(4)
            )
    return result


def transform_col_major_point(matrix, point):
    x, y, z = point
    return (
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    )


def matrix_reverses_winding(matrix, label):
    determinant = float(matrix.to_3x3().determinant())
    if not math.isfinite(determinant):
        raise ValueError(f"{label} matrix determinant must be finite")
    return determinant < 0.0


def matrix_from_transform(transform):
    if not isinstance(transform, dict):
        return identity_col_major_matrix()
    translation = transform.get("translation") if isinstance(transform.get("translation"), list) else [0.0, 0.0, 0.0]
    rotation = transform.get("rotation") if isinstance(transform.get("rotation"), list) else [0.0, 0.0, 0.0, 1.0]
    scale = transform.get("scale") if isinstance(transform.get("scale"), list) else [1.0, 1.0, 1.0]
    x = finite_number(rotation[0] if len(rotation) > 0 else 0.0, "rotation[0]")
    y = finite_number(rotation[1] if len(rotation) > 1 else 0.0, "rotation[1]")
    z = finite_number(rotation[2] if len(rotation) > 2 else 0.0, "rotation[2]")
    w = finite_number(rotation[3] if len(rotation) > 3 else 1.0, "rotation[3]")
    sx = finite_number(scale[0] if len(scale) > 0 else 1.0, "scale[0]")
    sy = finite_number(scale[1] if len(scale) > 1 else 1.0, "scale[1]")
    sz = finite_number(scale[2] if len(scale) > 2 else 1.0, "scale[2]")
    tx = finite_number(translation[0] if len(translation) > 0 else 0.0, "translation[0]")
    ty = finite_number(translation[1] if len(translation) > 1 else 0.0, "translation[1]")
    tz = finite_number(translation[2] if len(translation) > 2 else 0.0, "translation[2]")
    return [
        (1 - 2 * y * y - 2 * z * z) * sx,
        (2 * x * y + 2 * w * z) * sx,
        (2 * x * z - 2 * w * y) * sx,
        0.0,
        (2 * x * y - 2 * w * z) * sy,
        (1 - 2 * x * x - 2 * z * z) * sy,
        (2 * y * z + 2 * w * x) * sy,
        0.0,
        (2 * x * z + 2 * w * y) * sz,
        (2 * y * z - 2 * w * x) * sz,
        (1 - 2 * x * x - 2 * y * y) * sz,
        0.0,
        tx,
        ty,
        tz,
        1.0,
    ]


def matrix_from_node(node):
    matrix = node.get("matrix") if isinstance(node, dict) else None
    if isinstance(matrix, list) and len(matrix) >= 16:
        return [finite_number(matrix[index], f"matrix[{index}]") for index in range(16)]
    return matrix_from_transform(node.get("transform") if isinstance(node, dict) else None)


def build_world_matrix_resolver(nodes):
    node_by_id = {
        node.get("id"): node
        for node in nodes
        if isinstance(node, dict) and node.get("id") is not None
    }
    cache = {}

    def resolve(node):
        if not isinstance(node, dict):
            return identity_col_major_matrix()
        node_id = node.get("id")
        if node_id in cache:
            return list(cache[node_id])
        local = matrix_from_node(node)
        parent_id = node.get("parent")
        parent = node_by_id.get(parent_id)
        world = multiply_col_major_matrix(resolve(parent), local) if parent else local
        if node_id is not None:
            cache[node_id] = list(world)
        return world

    return resolve


def material_color_from_modelasset(material_def):
    params = material_def.get("shaderParams") if isinstance(material_def, dict) else None
    color = params.get("color") if isinstance(params, dict) else None
    if isinstance(color, list) and len(color) >= 3:
        r = finite_number(color[0], "material color[0]")
        g = finite_number(color[1], "material color[1]")
        b = finite_number(color[2], "material color[2]")
        a = finite_number(color[3], "material color[3]") if len(color) > 3 else 1.0
        return (r, g, b, a)
    return (0.70, 0.84, 0.96, 1.0)


def create_blender_material(material_id, material_def):
    material = bpy.data.materials.new(safe_id(material_def.get("name"), material_id))
    material.diffuse_color = material_color_from_modelasset(material_def)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = material.diffuse_color
        bsdf.inputs["Roughness"].default_value = 0.72
    return material


def apply_uvs(mesh, geometry, faces):
    uvs = geometry.get("uvs")
    if not isinstance(uvs, list) or len(uvs) < len(mesh.vertices) * 2:
        return
    uv_layer = mesh.uv_layers.new(name="ModelAssetUV")
    for polygon, face in zip(mesh.polygons, faces):
        for loop_index, vertex_index in zip(polygon.loop_indices, face):
            u = finite_number(uvs[vertex_index * 2], f"uvs[{vertex_index * 2}]")
            v = finite_number(uvs[vertex_index * 2 + 1], f"uvs[{vertex_index * 2 + 1}]")
            uv_layer.data[loop_index].uv = (u, v)


def make_mesh_object(mesh_def, material_lookup, world_matrix, convert_axes):
    geometry = mesh_def.get("geometry")
    if not isinstance(geometry, dict):
        raise ValueError(f"mesh {mesh_def.get('id')} must contain geometry")
    raw_vertices = read_positions(geometry)
    vertices = [
        webg_to_blender_position(transform_col_major_point(world_matrix, vertex), convert_axes)
        for vertex in raw_vertices
    ]
    faces = read_faces(geometry, len(vertices))
    mesh_name = safe_id(mesh_def.get("name"), safe_id(mesh_def.get("id"), "ModelAssetMesh"))
    mesh = bpy.data.meshes.new(mesh_name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    apply_uvs(mesh, geometry, faces)
    obj = bpy.data.objects.new(mesh_name, mesh)
    material_id = mesh_def.get("material")
    material = material_lookup.get(material_id)
    if material:
        mesh.materials.append(material)
    obj["webg_modelasset_mesh_id"] = safe_id(mesh_def.get("id"), mesh_name)
    return obj


def mesh_to_modelasset_geometry(
    obj,
    depsgraph,
    apply_modifiers,
    convert_axes,
    skin_armature=None,
    skin_bone_names=None,
):
    source = obj.evaluated_get(depsgraph) if apply_modifiers else obj
    mesh = source.to_mesh()
    try:
        world = obj.matrix_world
        reverse_winding = matrix_reverses_winding(world, obj.name)
        vertices = []
        for vertex in mesh.vertices:
            point = world @ vertex.co
            vertices.extend(blender_to_webg_position(point, convert_axes))

        indices = []
        polygon_loops = []
        for polygon in mesh.polygons:
            loop = list(polygon.vertices)
            if len(loop) < 3:
                continue
            if reverse_winding:
                # 負 scale や Mirror を含む world matrix を頂点へ焼き込むと座標系の handedness が反転する
                # Blender 上で外向きの面を ModelAsset でも外向きに保つため、出力 loop の順序も反転する
                loop.reverse()
            polygon_loops.append(loop)
            for index in range(1, len(loop) - 1):
                indices.extend([loop[0], loop[index], loop[index + 1]])

        uvs = [0.0] * (len(mesh.vertices) * 2)
        uv_layer = mesh.uv_layers.active
        if uv_layer:
            seen = set()
            for polygon in mesh.polygons:
                for loop_index in polygon.loop_indices:
                    vertex_index = mesh.loops[loop_index].vertex_index
                    if vertex_index in seen:
                        continue
                    uv = uv_layer.data[loop_index].uv
                    uvs[vertex_index * 2] = float(uv.x)
                    uvs[vertex_index * 2 + 1] = float(uv.y)
                    seen.add(vertex_index)

        geometry = {
            "vertexCount": len(mesh.vertices),
            "polygonCount": len(indices) // 3,
            "positions": [round(float(value), 8) for value in vertices],
            "uvs": [round(float(value), 8) for value in uvs],
            "indices": [int(value) for value in indices],
            "polygonLoops": [[int(value) for value in loop] for loop in polygon_loops],
        }
        skin = export_mesh_skin(
            obj,
            mesh,
            skin_armature,
            skin_bone_names,
        ) if skin_armature else None
        return geometry, skin
    finally:
        source.to_mesh_clear()


def export_material_def(obj, material_id):
    material = obj.active_material
    color = material.diffuse_color if material else (0.70, 0.84, 0.96, 1.0)
    return {
        "id": material_id,
        "name": material.name if material else material_id,
        "shaderParams": {
            "color": [float(color[0]), float(color[1]), float(color[2]), float(color[3])],
            "roughness": 0.72,
        },
    }


# meshを変形するArmature modifierから対象armatureを一意に取得する
# 複数armatureによる変形はModelAssetの1 mesh / 1 skeleton規約へ直接対応できないため例外にする
def find_mesh_armature(obj):
    armatures = []
    for modifier in obj.modifiers:
        if modifier.type == "ARMATURE" and modifier.object and modifier.object.type == "ARMATURE":
            if modifier.object not in armatures:
                armatures.append(modifier.object)
    if len(armatures) > 1:
        raise ValueError(f"{obj.name} uses multiple Armature modifiers")
    return armatures[0] if armatures else None


# Blenderのbone collectionを必ず親から子の順へ並べる
# ModelAsset joints.parentは先に生成済みのindexを参照するため、collection内部順には依存しない
def ordered_armature_bones(armature, included_names=None):
    ordered = []
    included = set(included_names) if included_names is not None else None

    def append_tree(bone):
        if included is None or bone.name in included:
            ordered.append(bone)
        for child in bone.children:
            append_tree(child)

    for bone in armature.data.bones:
        if bone.parent is None:
            append_tree(bone)
    expected = len(armature.data.bones) if included is None else len(included)
    if len(ordered) != expected:
        raise ValueError(f"Armature {armature.name} contains an invalid bone hierarchy")
    return ordered


# ModelAssetへ出力しないRigify制御用boneかどうかを名前から判定する
# ORG-/MCH-はweightや階層上の位置にかかわらず、書き出し対象へ含めない
def is_excluded_rigify_helper(bone_name):
    return bone_name.startswith("ORG-") or bone_name.startswith("MCH-")


# 書き出すmesh群のvertex groupを調べ、skinが実際に参照する通常bone集合を作る
# ORG-/MCH-は常に除外し、それらだけにweightを持つ頂点は後段のskin検証でエラーにする
def build_armature_export_bone_names(objects, armature):
    armature_names = {bone.name for bone in armature.data.bones}
    weighted_names = set()
    for obj in objects:
        if find_mesh_armature(obj) != armature:
            continue
        group_name_by_index = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            for assignment in vertex.groups:
                group_name = group_name_by_index.get(assignment.group)
                if (
                    assignment.weight > 0.0
                    and group_name in armature_names
                    and not is_excluded_rigify_helper(group_name)
                ):
                    weighted_names.add(group_name)
    if not weighted_names:
        raise ValueError(f"Armature {armature.name} has no positively weighted bones")

    included_names = set(weighted_names)
    for weighted_name in weighted_names:
        bone = armature.data.bones.get(weighted_name)
        while bone is not None:
            if not is_excluded_rigify_helper(bone.name):
                included_names.add(bone.name)
            bone = bone.parent
    if len(included_names) > MAX_EXPORTED_BONES:
        raise ValueError(
            f"Armature {armature.name} requires {len(included_names)} exported bones; "
            f"webg supports at most {MAX_EXPORTED_BONES}"
        )
    return included_names


# collapse後のskeletonで直上となる、最も近い書き出し対象ancestorを返す
# 間にある未使用helperの行列はworld差分へ自然に含まれるため、rest poseを維持できる
def nearest_included_parent(bone, included_names):
    parent = bone.parent
    while parent is not None and parent.name not in included_names:
        parent = parent.parent
    return parent


# rest poseをModelAsset skeletonへ変換する
# rootはworld行列、childは親boneに対するlocal行列とし、inverse bindはgeometryと同じworld空間で作る
def export_skeleton_def(armature, skeleton_id, convert_axes, included_names):
    bones = ordered_armature_bones(armature, included_names)
    index_by_name = {bone.name: index for index, bone in enumerate(bones)}
    world_by_name = {
        bone.name: armature.matrix_world @ bone.matrix_local
        for bone in bones
    }
    joints = []
    for bone in bones:
        parent = nearest_included_parent(bone, included_names)
        world = world_by_name[bone.name]
        local = world if parent is None else world_by_name[parent.name].inverted_safe() @ world
        webg_local = blender_to_webg_matrix(local, convert_axes)
        webg_inverse_bind = blender_to_webg_matrix(world, convert_axes).inverted_safe()
        joints.append({
            "name": bone.name,
            "parent": index_by_name[parent.name] if parent else None,
            "localMatrix": matrix_to_col_major(webg_local),
            "inverseBindMatrix": matrix_to_col_major(webg_inverse_bind),
        })
    return {
        "id": skeleton_id,
        "jointOrder": [bone.name for bone in bones],
        "joints": joints,
    }


# vertex groupから1頂点4枠のskin配列を生成する
# 影響数が4を超える場合は大きいweightを採用するが、weightなし頂点は変形定義の欠落として停止する
def export_mesh_skin(obj, mesh, armature, included_names):
    bones = ordered_armature_bones(armature, included_names)
    joint_by_name = {bone.name: index for index, bone in enumerate(bones)}
    group_name_by_index = {group.index: group.name for group in obj.vertex_groups}
    joint_indices = []
    joint_weights = []
    for vertex in mesh.vertices:
        influences = []
        for assignment in vertex.groups:
            group_name = group_name_by_index.get(assignment.group)
            if group_name not in joint_by_name or assignment.weight <= 0.0:
                continue
            influences.append((joint_by_name[group_name], finite_number(
                assignment.weight,
                f"{obj.name} vertex {vertex.index} weight"
            )))
        influences.sort(key=lambda item: item[1], reverse=True)
        influences = influences[:INFLUENCES_PER_VERTEX]
        total = sum(weight for _, weight in influences)
        if total <= 0.0:
            raise ValueError(
                f"{obj.name} vertex {vertex.index} has no weight for Armature {armature.name}"
            )
        normalized = [(joint, weight / total) for joint, weight in influences]
        while len(normalized) < INFLUENCES_PER_VERTEX:
            normalized.append((0, 0.0))
        joint_indices.extend(joint for joint, _ in normalized)
        joint_weights.extend(round(float(weight), 8) for _, weight in normalized)
    return {
        "influencesPerVertex": INFLUENCES_PER_VERTEX,
        "jointIndices": joint_indices,
        "jointWeights": joint_weights,
    }


# Blender 3.6のlegacy Actionと4.4以降のlayered ActionからFCurveを同じ形で列挙する
# layered Actionではlayer / strip / channelbagの内側にFCurveがあるため、旧propertyだけを見ない
def iter_action_fcurves(action):
    seen = set()
    legacy_curves = getattr(action, "fcurves", None)
    if legacy_curves is not None:
        for fcurve in legacy_curves:
            pointer = fcurve.as_pointer()
            if pointer not in seen:
                seen.add(pointer)
                yield fcurve
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for channelbag in getattr(strip, "channelbags", []):
                for fcurve in getattr(channelbag, "fcurves", []):
                    pointer = fcurve.as_pointer()
                    if pointer not in seen:
                        seen.add(pointer)
                        yield fcurve


# Actionが対象armatureのpose boneを操作しているか判定する
# object transformだけのActionはskeletal animationとして誤って出力しない
def action_targets_armature(action, armature):
    bone_names = {bone.name for bone in armature.data.bones}
    for fcurve in iter_action_fcurves(action):
        match = re.search(r'pose\.bones\["(.+?)"\]', fcurve.data_path)
        if match and match.group(1) in bone_names:
            return True
    return False


# 対象armatureのpose bone F-Curveに置かれたkeyframe時刻を重複なしで集める
# boneごとにkey時刻が異なっても、全trackが共有できる昇順のframe集合として返す
def collect_action_keyframes(action, armature):
    bone_names = {bone.name for bone in armature.data.bones}
    frames = set()
    for fcurve in iter_action_fcurves(action):
        match = re.search(r'pose\.bones\["(.+?)"\]', fcurve.data_path)
        if not match or match.group(1) not in bone_names:
            continue
        for keyframe in fcurve.keyframe_points:
            frame = finite_number(keyframe.co[0], f"Action {action.name} keyframe")
            frames.add(frame)
    if not frames:
        raise ValueError(f"Action {action.name} has no pose bone keyframes")
    return sorted(frames)


# Actionを実在するkeyframe時刻だけで評価し、全boneのpose matrix列へ変換する
# ModelAssetは共通timesを使うため、いずれかのboneにkeyがある時刻で全boneの姿勢を記録する
def export_armature_animations(context, armature, skeleton_id, convert_axes, included_names):
    actions = [action for action in bpy.data.actions if action_targets_armature(action, armature)]
    if not actions:
        return []
    scene = context.scene
    fps = finite_number(scene.render.fps, "scene.render.fps") / finite_number(
        scene.render.fps_base,
        "scene.render.fps_base"
    )
    if fps <= 0.0:
        raise ValueError("scene frame rate must be greater than zero")
    animation_data = armature.animation_data_create()
    saved_action = animation_data.action
    saved_use_nla = animation_data.use_nla
    saved_frame = scene.frame_current
    saved_subframe = scene.frame_subframe
    bones = ordered_armature_bones(armature, included_names)
    animations = []
    try:
        animation_data.use_nla = False
        for action in actions:
            frames = collect_action_keyframes(action, armature)
            start = frames[0]
            animation_data.action = action
            times = [round((frame - start) / fps, 8) for frame in frames]
            poses_by_name = {bone.name: [] for bone in bones}
            for frame in frames:
                whole_frame = math.floor(frame)
                scene.frame_set(whole_frame, subframe=frame - whole_frame)
                context.view_layer.update()
                for bone in bones:
                    pose_bone = armature.pose.bones.get(bone.name)
                    if pose_bone is None:
                        raise ValueError(f"Armature {armature.name} has no pose bone {bone.name}")
                    parent = nearest_included_parent(bone, included_names)
                    if parent:
                        parent_pose = armature.pose.bones.get(parent.name)
                        if parent_pose is None:
                            raise ValueError(f"Armature {armature.name} has no pose bone {parent.name}")
                        local = parent_pose.matrix.inverted_safe() @ pose_bone.matrix
                    else:
                        local = armature.matrix_world @ pose_bone.matrix
                    poses_by_name[bone.name].append(
                        matrix_to_col_major(blender_to_webg_matrix(local, convert_axes))
                    )
            animations.append({
                "id": f"{safe_id(action.name, 'Action')}_{skeleton_id}",
                "targetSkeleton": skeleton_id,
                "times": times,
                "tracks": [
                    {"joint": bone.name, "poses": poses_by_name[bone.name]}
                    for bone in bones
                ],
            })
    finally:
        animation_data.action = saved_action
        animation_data.use_nla = saved_use_nla
        scene.frame_set(saved_frame, subframe=saved_subframe)
        context.view_layer.update()
    return animations


# skeletonのlocal matrixを親から積み上げ、ModelAsset空間のrest world matrixを返す
# joints.parentの範囲と順序をここで検査し、壊れた階層をArmatureへ持ち込まない
def build_skeleton_world_matrices(skeleton_def):
    joints = skeleton_def.get("joints")
    if not isinstance(joints, list) or not joints:
        raise ValueError(f"skeleton {skeleton_def.get('id')} must contain joints")
    worlds = []
    for index, joint in enumerate(joints):
        local = matrix_from_col_major(joint.get("localMatrix"), f"joints[{index}].localMatrix")
        parent_index = joint.get("parent")
        if parent_index is None:
            world = local
        else:
            if not isinstance(parent_index, int) or parent_index < 0 or parent_index >= index:
                raise ValueError(f"joints[{index}].parent must reference an earlier joint")
            world = worlds[parent_index] @ local
        worlds.append(world)
    return worlds


# ModelAsset skeletonからBlender Armatureを作る
# joint matrixの姿勢をedit bone.matrixへ渡し、boneの長さだけはchild位置から表示用に決める
def import_skeleton_object(context, skeleton_def, convert_axes):
    skeleton_id = safe_id(skeleton_def.get("id"), "skeleton")
    joints = skeleton_def.get("joints")
    webg_worlds = build_skeleton_world_matrices(skeleton_def)
    blender_worlds = [webg_to_blender_matrix(matrix, convert_axes) for matrix in webg_worlds]
    armature_data = bpy.data.armatures.new(skeleton_id)
    armature = bpy.data.objects.new(skeleton_id, armature_data)
    context.collection.objects.link(armature)
    context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = []
    try:
        for index, joint in enumerate(joints):
            name = safe_id(joint.get("name"), f"joint_{index}")
            edit_bone = armature_data.edit_bones.new(name)
            parent_index = joint.get("parent")
            if parent_index is not None:
                edit_bone.parent = edit_bones[parent_index]
            child_distances = []
            target_matrix = blender_worlds[index]
            head = target_matrix.translation
            for child_index, child in enumerate(joints):
                if child.get("parent") == index:
                    child_distances.append((blender_worlds[child_index].translation - head).length)
            positive_lengths = [value for value in child_distances if value > 1.0e-5]
            length = min(positive_lengths) if positive_lengths else 0.25
            bone_y = target_matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))
            bone_z = target_matrix.to_3x3() @ Vector((0.0, 0.0, 1.0))
            if bone_y.length <= 1.0e-8 or bone_z.length <= 1.0e-8:
                raise ValueError(f"joint {name} has a degenerate rest matrix")
            edit_bone.head = head
            edit_bone.tail = head + bone_y.normalized() * length
            edit_bone.align_roll(bone_z.normalized())
            edit_bones.append(edit_bone)
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
    armature["webg_modelasset_skeleton_id"] = skeleton_id
    return armature


# ModelAsset skin配列をBlender vertex groupとArmature modifierへ復元する
# 配列長やjoint indexを検査し、誤ったweightを別boneへ読み替えない
def import_mesh_skin(obj, mesh_def, skeleton_def, armature):
    skin = mesh_def.get("skin")
    if not isinstance(skin, dict):
        return
    joints = skeleton_def.get("joints")
    influences = skin.get("influencesPerVertex", INFLUENCES_PER_VERTEX)
    if not isinstance(influences, int) or influences <= 0:
        raise ValueError(f"mesh {mesh_def.get('id')} influencesPerVertex must be positive")
    indices = skin.get("jointIndices")
    weights = skin.get("jointWeights")
    vertex_count = len(obj.data.vertices)
    expected = vertex_count * influences
    if not isinstance(indices, list) or not isinstance(weights, list):
        raise ValueError(f"mesh {mesh_def.get('id')} skin arrays are required")
    if len(indices) != expected or len(weights) != expected:
        raise ValueError(f"mesh {mesh_def.get('id')} skin arrays must contain {expected} values")
    groups = [
        obj.vertex_groups.new(name=safe_id(joint.get("name"), f"joint_{index}"))
        for index, joint in enumerate(joints)
    ]
    for vertex_index in range(vertex_count):
        total = 0.0
        assignments = []
        for slot in range(influences):
            offset = vertex_index * influences + slot
            joint_index = indices[offset]
            weight = finite_number(weights[offset], f"jointWeights[{offset}]")
            if not isinstance(joint_index, int) or joint_index < 0 or joint_index >= len(groups):
                raise ValueError(f"jointIndices[{offset}] references unknown joint {joint_index}")
            if weight < 0.0:
                raise ValueError(f"jointWeights[{offset}] must not be negative")
            if weight > 0.0:
                assignments.append((joint_index, weight))
                total += weight
        if total <= 0.0:
            raise ValueError(f"mesh {mesh_def.get('id')} vertex {vertex_index} has no skin weight")
        for joint_index, weight in assignments:
            groups[joint_index].add([vertex_index], weight / total, "REPLACE")
    modifier = obj.modifiers.new(name="ModelAssetArmature", type="ARMATURE")
    modifier.object = armature


# ModelAsset animationをBlender Actionへ復元する
# track poseはbone local行列なので親からworld poseを組み立て、pose bone.matrixへ設定してkeyframe化する
def import_skeleton_animations(context, skeleton_def, armature, animation_defs, convert_axes):
    joints = skeleton_def.get("joints")
    skeleton_id = skeleton_def.get("id")
    matching = [item for item in animation_defs if item.get("targetSkeleton") == skeleton_id]
    if not matching:
        return []
    fps = finite_number(context.scene.render.fps, "scene.render.fps") / finite_number(
        context.scene.render.fps_base,
        "scene.render.fps_base"
    )
    if fps <= 0.0:
        raise ValueError("scene frame rate must be greater than zero")
    actions = []
    animation_data = armature.animation_data_create()
    for animation_def in matching:
        animation_id = safe_id(animation_def.get("id"), "ModelAssetAction")
        times = animation_def.get("times")
        tracks = animation_def.get("tracks")
        if not isinstance(times, list) or not times:
            raise ValueError(f"animation {animation_id} must contain times")
        if not isinstance(tracks, list):
            raise ValueError(f"animation {animation_id} must contain tracks")
        track_by_joint = {track.get("joint"): track for track in tracks}
        for track in tracks:
            poses = track.get("poses")
            if not isinstance(poses, list) or len(poses) != len(times):
                raise ValueError(f"animation {animation_id} track {track.get('joint')} pose count mismatch")
        action = bpy.data.actions.new(animation_id)
        animation_data.action = action
        for pose_bone in armature.pose.bones:
            pose_bone.rotation_mode = "QUATERNION"
        for time_index, time_value in enumerate(times):
            seconds = finite_number(time_value, f"animation {animation_id} times[{time_index}]")
            frame = 1.0 + seconds * fps
            pose_worlds = []
            for joint_index, joint in enumerate(joints):
                joint_name = safe_id(joint.get("name"), f"joint_{joint_index}")
                track = track_by_joint.get(joint_name)
                pose_values = track["poses"][time_index] if track else joint.get("localMatrix")
                local_webg = matrix_from_col_major(
                    pose_values,
                    f"animation {animation_id} {joint_name} pose[{time_index}]"
                )
                local_blender = webg_to_blender_matrix(local_webg, convert_axes)
                parent_index = joint.get("parent")
                world = local_blender if parent_index is None else pose_worlds[parent_index] @ local_blender
                pose_worlds.append(world)
                pose_bone = armature.pose.bones.get(joint_name)
                if pose_bone is None:
                    raise ValueError(f"Armature {armature.name} has no pose bone {joint_name}")
                pose_bone.matrix = world
            context.view_layer.update()
            for joint_index, joint in enumerate(joints):
                joint_name = safe_id(joint.get("name"), f"joint_{joint_index}")
                if joint_name not in track_by_joint:
                    continue
                pose_bone = armature.pose.bones[joint_name]
                pose_bone.keyframe_insert(data_path="location", frame=frame, group=joint_name)
                pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=joint_name)
                pose_bone.keyframe_insert(data_path="scale", frame=frame, group=joint_name)
        for fcurve in iter_action_fcurves(action):
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "LINEAR"
        actions.append(action)
    if actions:
        animation_data.action = actions[0]
    return actions


class ImportWebgModelAsset(bpy.types.Operator, ImportHelper):
    bl_idname = "import_scene.webg_animated_modelasset_json"
    bl_label = "Import Webg Animated ModelAsset JSON"
    bl_options = {"PRESET", "UNDO"}

    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json;*.json.gz", options={"HIDDEN"})
    convert_axes: BoolProperty(
        name="Convert Y-up to Blender Z-up",
        description="Map ModelAsset coordinates (X,Y,Z) to Blender coordinates (X,-Z,Y)",
        default=True,
    )
    use_nodes: BoolProperty(
        name="Use Node Transforms",
        description="Apply ModelAsset node world transforms to imported vertices",
        default=True,
    )
    import_skeletons: BoolProperty(
        name="Import Skeletons",
        description="Create Blender Armatures and restore mesh vertex weights",
        default=True,
    )
    import_animations: BoolProperty(
        name="Import Animations",
        description="Create Blender Actions from ModelAsset skeleton animation clips",
        default=True,
    )

    # File Browserのoption panelへanimation関連switchを固定順で表示する
    # Blenderのversionによる自動property列挙順の差を避け、依存関係を画面上でも読みやすくする
    def draw(self, context):
        layout = self.layout
        layout.prop(self, "convert_axes")
        layout.prop(self, "use_nodes")
        layout.prop(self, "import_skeletons")
        column = layout.column()
        column.enabled = self.import_skeletons
        column.prop(self, "import_animations")

    def execute(self, context):
        try:
            if self.import_animations and not self.import_skeletons:
                raise ValueError("Import Animations requires Import Skeletons")
            data = load_modelasset_json(self.filepath)
            meshes = data.get("meshes")
            if not isinstance(meshes, list) or not meshes:
                raise ValueError("ModelAsset JSON must contain meshes")

            material_lookup = {}
            for material_def in data.get("materials", []):
                if isinstance(material_def, dict):
                    material_id = material_def.get("id")
                    material_lookup[material_id] = create_blender_material(material_id, material_def)

            mesh_by_id = {
                mesh_def.get("id"): mesh_def
                for mesh_def in meshes
                if isinstance(mesh_def, dict)
            }
            nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
            resolver = build_world_matrix_resolver(nodes)
            skeleton_defs = {
                item.get("id"): item
                for item in data.get("skeletons", [])
                if isinstance(item, dict) and item.get("id")
            }
            armature_by_id = {}
            if self.import_skeletons:
                bpy.ops.object.select_all(action="DESELECT")
                for skeleton_id, skeleton_def in skeleton_defs.items():
                    armature_by_id[skeleton_id] = import_skeleton_object(
                        context,
                        skeleton_def,
                        self.convert_axes
                    )
            objects = []
            if self.use_nodes and nodes:
                for node in nodes:
                    mesh_id = node.get("mesh") if isinstance(node, dict) else None
                    mesh_def = mesh_by_id.get(mesh_id)
                    if not mesh_def:
                        continue
                    obj = make_mesh_object(mesh_def, material_lookup, resolver(node), self.convert_axes)
                    obj.name = safe_id(node.get("name"), obj.name)
                    obj["webg_modelasset_node_id"] = safe_id(node.get("id"), obj.name)
                    context.collection.objects.link(obj)
                    skeleton_id = node.get("skeleton")
                    if self.import_skeletons and mesh_def.get("skin"):
                        skeleton_def = skeleton_defs.get(skeleton_id)
                        armature = armature_by_id.get(skeleton_id)
                        if not skeleton_def or not armature:
                            raise ValueError(
                                f"node {node.get('id')} references unknown skeleton {skeleton_id}"
                            )
                        import_mesh_skin(obj, mesh_def, skeleton_def, armature)
                    objects.append(obj)
            if not objects:
                for mesh_def in meshes:
                    obj = make_mesh_object(mesh_def, material_lookup, identity_col_major_matrix(), self.convert_axes)
                    context.collection.objects.link(obj)
                    if self.import_skeletons and mesh_def.get("skin"):
                        if len(skeleton_defs) != 1:
                            raise ValueError(
                                f"mesh {mesh_def.get('id')} has skin but no node gives a unique skeleton"
                            )
                        skeleton_id, skeleton_def = next(iter(skeleton_defs.items()))
                        import_mesh_skin(obj, mesh_def, skeleton_def, armature_by_id[skeleton_id])
                    objects.append(obj)

            imported_actions = []
            if self.import_animations:
                animation_defs = data.get("animations") if isinstance(data.get("animations"), list) else []
                for skeleton_id, armature in armature_by_id.items():
                    imported_actions.extend(import_skeleton_animations(
                        context,
                        skeleton_defs[skeleton_id],
                        armature,
                        animation_defs,
                        self.convert_axes
                    ))

            bpy.ops.object.select_all(action="DESELECT")
            for obj in objects:
                obj.select_set(True)
            context.view_layer.objects.active = objects[0] if objects else None
            self.report({"INFO"}, (
                f"Imported {len(objects)} mesh object(s), "
                f"{len(armature_by_id)} skeleton(s), {len(imported_actions)} animation(s)"
            ))
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


class ExportWebgModelAsset(bpy.types.Operator, ExportHelper):
    bl_idname = "export_scene.webg_animated_modelasset_json"
    bl_label = "Export Webg Animated ModelAsset JSON"
    bl_options = {"PRESET"}

    filename_ext = ".json.gz"
    filter_glob: StringProperty(default="*.json;*.json.gz", options={"HIDDEN"})
    export_gzip: BoolProperty(
        name="Export as .json.gz",
        description="Write gzip-compressed ModelAsset JSON. Disable to write plain .json",
        default=True,
    )
    use_selection: BoolProperty(
        name="Selected Objects Only",
        description="Export only selected mesh objects",
        default=True,
    )
    apply_modifiers: BoolProperty(
        name="Apply Modifiers",
        description="Export evaluated mesh data with modifiers applied",
        default=True,
    )
    convert_axes: BoolProperty(
        name="Convert Blender Z-up to Y-up",
        description="Map Blender coordinates (X,Y,Z) to ModelAsset coordinates (X,Z,-Y)",
        default=True,
    )
    export_skeletons: BoolProperty(
        name="Export Skeletons",
        description="Export Armature bones and mesh vertex weights",
        default=True,
    )
    export_animations: BoolProperty(
        name="Export Animations",
        description="Export pose bone keyframes from Blender Actions",
        default=True,
    )

    # File Browserへstatic meshとskeletal animationの選択肢を明示する
    # AnimationはSkeletonを参照するため、Skeleton OFF時は関連propertyを操作不能にする
    def draw(self, context):
        layout = self.layout
        layout.prop(self, "export_gzip")
        layout.prop(self, "use_selection")
        layout.prop(self, "apply_modifiers")
        layout.prop(self, "convert_axes")
        layout.prop(self, "export_skeletons")
        column = layout.column()
        column.enabled = self.export_skeletons
        column.prop(self, "export_animations")

    def check(self, context):
        expected_ext = export_filename_ext(self.export_gzip)
        changed = False
        if self.filename_ext != expected_ext:
            self.filename_ext = expected_ext
            changed = True
        if self.filepath:
            normalized_filepath = resolve_export_filepath(self.filepath, self.export_gzip)
            if normalized_filepath != self.filepath:
                self.filepath = normalized_filepath
                changed = True
        return changed

    def execute(self, context):
        try:
            if self.export_animations and not self.export_skeletons:
                raise ValueError("Export Animations requires Export Skeletons")
            source_objects = context.selected_objects if self.use_selection else context.scene.objects
            objects = [obj for obj in source_objects if obj.type == "MESH"]
            if not objects:
                raise ValueError("No mesh objects to export")

            depsgraph = context.evaluated_depsgraph_get()
            export_filepath = resolve_export_filepath(self.filepath, self.export_gzip)
            base_filename = os.path.basename(export_filepath)
            base_name = base_filename[:-8] if base_filename.lower().endswith(".json.gz") else os.path.splitext(base_filename)[0]
            base_name = base_name or "modelasset"
            materials = []
            meshes = []
            nodes = []
            armatures = []
            armature_for_object = {}
            if self.export_skeletons:
                for obj in objects:
                    armature = find_mesh_armature(obj)
                    armature_for_object[obj.name_full] = armature
                    if armature and armature not in armatures:
                        armatures.append(armature)
            skeleton_id_by_armature = {
                armature.name_full: f"skeleton_{index}"
                for index, armature in enumerate(armatures)
            }
            bone_names_by_armature = {
                armature.name_full: build_armature_export_bone_names(objects, armature)
                for armature in armatures
            }
            skeletons = [
                export_skeleton_def(
                    armature,
                    skeleton_id_by_armature[armature.name_full],
                    self.convert_axes,
                    bone_names_by_armature[armature.name_full]
                )
                for armature in armatures
            ]
            animations = []
            if self.export_animations:
                for armature in armatures:
                    animations.extend(export_armature_animations(
                        context,
                        armature,
                        skeleton_id_by_armature[armature.name_full],
                        self.convert_axes,
                        bone_names_by_armature[armature.name_full]
                    ))
            for index, obj in enumerate(objects):
                mesh_id = f"mesh_{index}"
                node_id = f"node_{index}"
                material_id = f"mat_{index}" if obj.active_material else DEFAULT_MATERIAL_ID
                if obj.active_material:
                    materials.append(export_material_def(obj, material_id))
                elif not any(material.get("id") == DEFAULT_MATERIAL_ID for material in materials):
                    materials.append({
                        "id": DEFAULT_MATERIAL_ID,
                        "shaderParams": {
                            "color": [0.70, 0.84, 0.96, 1.0],
                            "roughness": 0.72,
                        },
                    })
                armature = armature_for_object.get(obj.name_full)
                geometry, skin = mesh_to_modelasset_geometry(
                    obj,
                    depsgraph,
                    self.apply_modifiers if armature is None else False,
                    self.convert_axes,
                    armature,
                    bone_names_by_armature.get(armature.name_full) if armature else None
                )
                mesh_def = {
                    "id": mesh_id,
                    "name": obj.name,
                    "material": material_id,
                    "geometry": geometry,
                }
                if skin:
                    mesh_def["skin"] = skin
                meshes.append(mesh_def)
                skeleton_id = skeleton_id_by_armature.get(armature.name_full) if armature else None
                animation_bindings = [
                    animation["id"]
                    for animation in animations
                    if animation["targetSkeleton"] == skeleton_id
                ]
                nodes.append({
                    "id": node_id,
                    "name": obj.name,
                    "parent": None,
                    "mesh": mesh_id,
                    "skeleton": skeleton_id,
                    "animationBindings": animation_bindings,
                    "transform": {
                        "translation": [0.0, 0.0, 0.0],
                        "rotation": [0.0, 0.0, 0.0, 1.0],
                        "scale": [1.0, 1.0, 1.0],
                    },
                })

            data = {
                "version": "1.0",
                "type": MODEL_ASSET_TYPE,
                "meta": {
                    "name": base_name,
                    "generator": "samples/compute_json/blender_modelasset_animation_io.py",
                    "source": "Blender",
                    "unitScale": 1.0,
                    "upAxis": "Y" if self.convert_axes else "Z",
                },
                "materials": materials,
                "meshes": meshes,
                "skeletons": skeletons,
                "animations": animations,
                "nodes": nodes,
            }
            save_modelasset_json(export_filepath, data)
            self.report({"INFO"}, (
                f"Exported {len(objects)} mesh object(s), {len(skeletons)} skeleton(s), "
                f"{len(animations)} animation(s) to {os.path.basename(export_filepath)}"
            ))
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


def menu_import(self, context):
    self.layout.operator(ImportWebgModelAsset.bl_idname, text="Webg Animated ModelAsset JSON (.json)")


def menu_export(self, context):
    self.layout.operator(ExportWebgModelAsset.bl_idname, text="Webg Animated ModelAsset JSON (.json)")


classes = (
    ImportWebgModelAsset,
    ExportWebgModelAsset,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_import.append(menu_import)
    bpy.types.TOPBAR_MT_file_export.append(menu_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu_export)
    bpy.types.TOPBAR_MT_file_import.remove(menu_import)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
