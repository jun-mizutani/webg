bl_info = {
    "name": "Webg ModelAsset JSON I/O",
    "author": "Jun Mizutani",
    "version": (0, 1, 1),
    "blender": (3, 6, 0),
    "location": "File > Import/Export",
    "description": "Import and export webg ModelAsset JSON mesh files",
    "category": "Import-Export",
}

import json
import gzip
import math
import os

import bpy
from bpy_extras.io_utils import ExportHelper, ImportHelper
from bpy.props import BoolProperty, StringProperty


MODEL_ASSET_TYPE = "webg-model-asset"
DEFAULT_MATERIAL_ID = "modelasset_mat"


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


def mesh_to_modelasset_geometry(obj, depsgraph, apply_modifiers, convert_axes):
    source = obj.evaluated_get(depsgraph) if apply_modifiers else obj
    mesh = source.to_mesh()
    try:
        world = obj.matrix_world
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

        return {
            "vertexCount": len(mesh.vertices),
            "polygonCount": len(indices) // 3,
            "positions": [round(float(value), 8) for value in vertices],
            "uvs": [round(float(value), 8) for value in uvs],
            "indices": [int(value) for value in indices],
            "polygonLoops": [[int(value) for value in loop] for loop in polygon_loops],
        }
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


class ImportWebgModelAsset(bpy.types.Operator, ImportHelper):
    bl_idname = "import_scene.webg_modelasset_json"
    bl_label = "Import Webg ModelAsset JSON"
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

    def execute(self, context):
        try:
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
                    objects.append(obj)
            if not objects:
                for mesh_def in meshes:
                    obj = make_mesh_object(mesh_def, material_lookup, identity_col_major_matrix(), self.convert_axes)
                    context.collection.objects.link(obj)
                    objects.append(obj)

            bpy.ops.object.select_all(action="DESELECT")
            for obj in objects:
                obj.select_set(True)
            context.view_layer.objects.active = objects[0] if objects else None
            self.report({"INFO"}, f"Imported {len(objects)} ModelAsset mesh object(s)")
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


class ExportWebgModelAsset(bpy.types.Operator, ExportHelper):
    bl_idname = "export_scene.webg_modelasset_json"
    bl_label = "Export Webg ModelAsset JSON"
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

    def execute(self, context):
        try:
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
                meshes.append({
                    "id": mesh_id,
                    "name": obj.name,
                    "material": material_id,
                    "geometry": mesh_to_modelasset_geometry(obj, depsgraph, self.apply_modifiers, self.convert_axes),
                })
                nodes.append({
                    "id": node_id,
                    "name": obj.name,
                    "parent": None,
                    "mesh": mesh_id,
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
                    "generator": "tools/blender_modelasset_io.py",
                    "source": "Blender",
                    "unitScale": 1.0,
                    "upAxis": "Y" if self.convert_axes else "Z",
                },
                "materials": materials,
                "meshes": meshes,
                "skeletons": [],
                "animations": [],
                "nodes": nodes,
            }
            save_modelasset_json(export_filepath, data)
            self.report({"INFO"}, f"Exported {len(objects)} ModelAsset mesh object(s) to {os.path.basename(export_filepath)}")
            return {"FINISHED"}
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


def menu_import(self, context):
    self.layout.operator(ImportWebgModelAsset.bl_idname, text="Webg ModelAsset JSON (.json)")


def menu_export(self, context):
    self.layout.operator(ExportWebgModelAsset.bl_idname, text="Webg ModelAsset JSON (.json)")


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
