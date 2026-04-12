// ---------------------------------------------
// Collada.js     2026/03/08
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Matrix from "./Matrix.js";
import Stack from "./Stack.js";
import Mesh from "./Mesh.js";
import Frame from "./Frame.js";
import Animation from "./Animation.js";

export default class Collada {
  // COLLADA(XML)を解析し、Frame/Mesh/Animation情報へ分解するパーサ本体
  static get ID() { return  {
                       COLLADA :    1,
                   IDREF_array :    2,
                    Name_array :    3,
                      accessor :    4,
                  adapt_thresh :    5,
                         alpha :    6,
                       ambient :    7,
                     animation :    8,
                animation_clip :    9,
                      annotate :   10,
                    area_shape :   11,
                     area_size :   12,
                    area_sizey :   13,
                    area_sizez :   14,
                      argument :   15,
                         array :   16,
                  aspect_ratio :   17,
                         asset :   18,
           atm_distance_factor :   19,
         atm_extinction_factor :   20,
                 atm_turbidity :   21,
                          att1 :   22,
                          att2 :   23,
                    attachment :   24,
                        author :   25,
                authoring_tool :   26,
           backscattered_light :   27,
                          bias :   28,
                          bind :   29,
                 bind_material :   30,
             bind_shape_matrix :   31,
             bind_vertex_input :   32,
                         blinn :   33,
                          blue :   34,
                    bool_array :   35,
                           box :   36,
                       buffers :   37,
                       bufflag :   38,
                       bufsize :   39,
                       buftype :   40,
                        camera :   41,
                       capsule :   42,
                       channel :   43,
                       clipend :   44,
                       clipsta :   45,
                          code :   46,
                         color :   47,
                   color_clear :   48,
                  color_target :   49,
  common_color_or_texture_type :   50,
    common_float_or_param_type :   51,
              compiler_options :   52,
               compiler_target :   53,
                compressthresh :   54,
                 connect_param :   55,
                      constant :   56,
          constant_attenuation :   57,
                   contributor :   58,
              control_vertices :   59,
                    controller :   60,
                   convex_mesh :   61,
                       created :   62,
                      cylinder :   63,
                   depth_clear :   64,
                  depth_target :   65,
                       diffuse :   66,
                   directional :   67,
                          dist :   68,
                  double_sided :   69,
                          draw :   70,
                        effect :   71,
                      emission :   72,
                        energy :   73,
                         extra :   74,
                  falloff_type :   75,
                    filtertype :   76,
                          flag :   77,
                         float :   78,
                   float_array :   79,
                   force_field :   80,
                         gamma :   81,
                      geometry :   82,
                         green :   83,
                halo_intensity :   84,
            horizon_brightness :   85,
                         image :   86,
                        imager :   87,
           index_of_refraction :   88,
                     init_from :   89,
                         input :   90,
            instance_animation :   91,
               instance_camera :   92,
           instance_controller :   93,
               instance_effect :   94,
          instance_force_field :   95,
             instance_geometry :   96,
                instance_light :   97,
             instance_material :   98,
                 instance_node :   99,
     instance_physics_material :  100,
        instance_physics_model :  101,
        instance_physics_scene :  102,
           instance_rigid_body :  103,
     instance_rigid_constraint :  104,
         instance_visual_scene :  105,
                     int_array :  106,
                        joints :  107,
                       lambert :  108,
    vivlibrary_animation_clips :  109,
            library_animations :  110,
               library_cameras :  111,
           library_controllers :  112,
               library_effects :  113,
          library_force_fields :  114,
            library_geometries :  115,
                library_images :  116,
                library_lights :  117,
             library_materials :  118,
                 library_nodes :  119,
     library_physics_materials :  120,
        library_physics_models :  121,
        library_physics_scenes :  122,
         library_visual_scenes :  123,
                         light :  124,
            linear_attenuation :  125,
                         lines :  126,
                    linestrips :  127,
                        lookat :  128,
                      material :  129,
                        matrix :  130,
                          mesh :  131,
                          mode :  132,
                      modified :  133,
                         morph :  134,
                      newparam :  135,
                          node :  136,
                        optics :  137,
                  orthographic :  138,
                             p :  139,
                         param :  140,
                   perspective :  141,
                         phong :  142,
              physics_material :  143,
                 physics_model :  144,
                 physics_scene :  145,
                         plane :  146,
                         point :  147,
                      polygons :  148,
                      polylist :  149,
                profile_COMMON :  150,
         quadratic_attenuation :  151,
                      ray_samp :  152,
               ray_samp_method :  153,
                 ray_samp_type :  154,
                     ray_sampy :  155,
                     ray_sampz :  156,
                           red :  157,
                ref_attachment :  158,
                  reflectivity :  159,
                    rigid_body :  160,
              rigid_constraint :  161,
                        rotate :  162,
                          samp :  163,
                       sampler :  164,
                     sampler2D :  165,
                         scale :  166,
                         scene :  167,
                  shadhalostep :  168,
                      shadow_b :  169,
                      shadow_g :  170,
                      shadow_r :  171,
                  shadspotsize :  172,
                         shape :  173,
                     shininess :  174,
                      skeleton :  175,
                          skew :  176,
                          skin :  177,
                sky_colorspace :  178,
                  sky_exposure :  179,
                   skyblendfac :  180,
                  skyblendtype :  181,
                          soft :  182,
                        source :  183,
                      specular :  184,
                        sphere :  185,
                        spline :  186,
                          spot :  187,
                     spotblend :  188,
                      spotsize :  189,
                        spread :  190,
                sun_brightness :  191,
               sun_effect_type :  192,
                 sun_intensity :  193,
                      sun_size :  194,
                       surface :  195,
               tapered_capsule :  196,
              tapered_cylinder :  197,
                       targets :  198,
                     technique :  199,
              technique_common :  200,
                     translate :  201,
                   transparent :  202,
                  transparency :  203,
                     triangles :  204,
                       trifans :  205,
                     tristrips :  206,
                          type :  207,
                          unit :  208,
                       up_axis :  209,
                             v :  210,
                        vcount :  211,
                vertex_weights :  212,
                      vertices :  213,
                  visual_scene :  214,
                          xfov :  215,
                          yfov :  216,
                          zfar :  217,
                         znear :  218,
                    YF_dofdist :  219,
                        shiftx :  220,
                        shifty :  221,
          ambient_diffuse_lock :  222,
  ambient_diffuse_texture_lock :  223,
      apply_reflection_dimming :  224,
         diffuse_specular_lock :  225,
                     dim_level :  226,
               extended_shader :  227,
                  opacity_type :  228,
              reflection_level :  229,
                    reflective :  230,
                        shader :  231,
                        soften :  232,
                   source_data :  233,
          use_self_illum_color :  234,
                     wire_size :  235,
                    wire_units :  236,
    };
  }

  static get elementName()  { return {
    COLLADA : Collada.ID.COLLADA,
    IDREF_array : Collada.ID.IDREF_array,
    Name_array : Collada.ID.Name_array,
    accessor : Collada.ID.accessor,
    adapt_thresh : Collada.ID.adapt_thresh,
    alpha : Collada.ID.alpha,
    ambient : Collada.ID.ambient,
    animation : Collada.ID.animation,
    animation_clip : Collada.ID.animation_clip,
    annotate : Collada.ID.annotate,
    area_shape : Collada.ID.area_shape,
    area_size : Collada.ID.area_size,
    area_sizey : Collada.ID.area_sizey,
    area_sizez : Collada.ID.area_sizez,
    argument : Collada.ID.argument,
    array : Collada.ID.array,
    aspect_ratio : Collada.ID.aspect_ratio,
    asset : Collada.ID.asset,
    atm_distance_factor : Collada.ID.atm_distance_factor,
    atm_extinction_factor : Collada.ID.atm_extinction_factor,
    atm_turbidity : Collada.ID.atm_turbidity,
    att1 : Collada.ID.att1,
    att2 : Collada.ID.att2,
    attachment : Collada.ID.attachment,
    author : Collada.ID.author,
    authoring_tool : Collada.ID.authoring_tool,
    backscattered_light : Collada.ID.backscattered_light,
    bias : Collada.ID.bias,
    bind : Collada.ID.bind,
    bind_material : Collada.ID.bind_material,
    bind_shape_matrix : Collada.ID.bind_shape_matrix,
    bind_vertex_input : Collada.ID.bind_vertex_input,
    blinn : Collada.ID.blinn,
    blue : Collada.ID.blue,
    bool_array : Collada.ID.bool_array,
    box : Collada.ID.box,
    buffers : Collada.ID.buffers,
    bufflag : Collada.ID.bufflag,
    bufsize : Collada.ID.bufsize,
    buftype : Collada.ID.buftype,
    camera : Collada.ID.camera,
    capsule : Collada.ID.capsule,
    channel : Collada.ID.channel,
    clipend : Collada.ID.clipend,
    clipsta : Collada.ID.clipsta,
    code : Collada.ID.code,
      color : Collada.ID.color,
    color_clear : Collada.ID.color_clear,
    color_target : Collada.ID.color_target,
    common_color_or_texture_type : Collada.ID.common_color_or_texture_type,
    common_float_or_param_type : Collada.ID.common_float_or_param_type,
    compiler_options : Collada.ID.compiler_options,
    compiler_target : Collada.ID.compiler_target,
    compressthresh : Collada.ID.compressthresh,
    connect_param : Collada.ID.connect_param,
    constant : Collada.ID.constant,
    constant_attenuation : Collada.ID.constant_attenuation,
    contributor : Collada.ID.contributor,
    control_vertices : Collada.ID.control_vertices,
    controller : Collada.ID.controller,
    convex_mesh : Collada.ID.convex_mesh,
    created : Collada.ID.created,
    cylinder : Collada.ID.cylinder,
    depth_clear : Collada.ID.depth_clear,
    depth_target : Collada.ID.depth_target,
    diffuse : Collada.ID.diffuse,
    directional : Collada.ID.directional,
    dist : Collada.ID.dist,
    double_sided : Collada.ID.double_sided,
    draw : Collada.ID.draw,
    effect : Collada.ID.effect,
    emission : Collada.ID.emission,
    energy : Collada.ID.energy,
    extra : Collada.ID.extra,
    falloff_type : Collada.ID.falloff_type,
    filtertype : Collada.ID.filtertype,
    flag : Collada.ID.flag,
    float : Collada.ID.float,
    float_array : Collada.ID.float_array,
    force_field : Collada.ID.force_field,
    gamma : Collada.ID.gamma,
    geometry : Collada.ID.geometry,
    green : Collada.ID.green,
    halo_intensity : Collada.ID.halo_intensity,
    horizon_brightness : Collada.ID.horizon_brightness,
    image : Collada.ID.image,
    imager : Collada.ID.imager,
    index_of_refraction : Collada.ID.index_of_refraction,
    init_from : Collada.ID.init_from,
    input : Collada.ID.input,
    instance_animation : Collada.ID.instance_animation,
    instance_camera : Collada.ID.instance_camera,
    instance_controller : Collada.ID.instance_controller,
    instance_effect : Collada.ID.instance_effect,
    instance_force_field : Collada.ID.instance_force_field,
    instance_geometry : Collada.ID.instance_geometry,
    instance_light : Collada.ID.instance_light,
    instance_material : Collada.ID.instance_material,
    instance_node : Collada.ID.instance_node,
    instance_physics_material : Collada.ID.instance_physics_material,
    instance_physics_model : Collada.ID.instance_physics_model,
    instance_physics_scene : Collada.ID.instance_physics_scene,
    instance_rigid_body : Collada.ID.instance_rigid_body,
    instance_rigid_constraint : Collada.ID.instance_rigid_constraint,
    instance_visual_scene : Collada.ID.instance_visual_scene,
    int_array : Collada.ID.int_array,
    joints : Collada.ID.joints,
    lambert : Collada.ID.lambert,
    vivlibrary_animation_clips : Collada.ID.vivlibrary_animation_clips,
    library_animations : Collada.ID.library_animations,
    library_cameras : Collada.ID.library_cameras,
    library_controllers : Collada.ID.library_controllers,
    library_effects : Collada.ID.library_effects,
    library_force_fields : Collada.ID.library_force_fields,
    library_geometries : Collada.ID.library_geometries,
    library_images : Collada.ID.library_images,
    library_lights : Collada.ID.library_lights,
    library_materials : Collada.ID.library_materials,
    library_nodes : Collada.ID.library_nodes,
    library_physics_materials : Collada.ID.library_physics_materials,
    library_physics_models : Collada.ID.library_physics_models,
    library_physics_scenes : Collada.ID.library_physics_scenes,
    library_visual_scenes : Collada.ID.library_visual_scenes,
    light : Collada.ID.light,
    linear_attenuation : Collada.ID.linear_attenuation,
    lines : Collada.ID.lines,
    linestrips : Collada.ID.linestrips,
    lookat : Collada.ID.lookat,
    material : Collada.ID.material,
    matrix : Collada.ID.matrix,
    mesh : Collada.ID.mesh,
    mode : Collada.ID.mode,
    modified : Collada.ID.modified,
    morph : Collada.ID.morph,
    newparam : Collada.ID.newparam,
    node : Collada.ID.node,
    optics : Collada.ID.optics,
    orthographic : Collada.ID.orthographic,
    p : Collada.ID.p,
    param : Collada.ID.param,
    perspective : Collada.ID.perspective,
    phong : Collada.ID.phong,
    physics_material : Collada.ID.physics_material,
    physics_model : Collada.ID.physics_model,
    physics_scene : Collada.ID.physics_scene,
    plane : Collada.ID.plane,
    point : Collada.ID.point,
    polygons : Collada.ID.polygons,
    polylist : Collada.ID.polylist,
    profile_COMMON : Collada.ID.profile_COMMON,
    quadratic_attenuation : Collada.ID.quadratic_attenuation,
    ray_samp : Collada.ID.ray_samp,
    ray_samp_method : Collada.ID.ray_samp_method,
    ray_samp_type : Collada.ID.ray_samp_type,
    ray_sampy : Collada.ID.ray_sampy,
    ray_sampz : Collada.ID.ray_sampz,
    red : Collada.ID.red,
    ref_attachment : Collada.ID.ref_attachment,
    reflectivity : Collada.ID.reflectivity,
    rigid_body : Collada.ID.rigid_body,
    rigid_constraint : Collada.ID.rigid_constraint,
    rotate : Collada.ID.rotate,
    samp : Collada.ID.samp,
    sampler : Collada.ID.sampler,
    sampler2D : Collada.ID.sampler2D,
    scale : Collada.ID.scale,
    scene : Collada.ID.scene,
    shadhalostep : Collada.ID.shadhalostep,
    shadow_b : Collada.ID.shadow_b,
    shadow_g : Collada.ID.shadow_g,
    shadow_r : Collada.ID.shadow_r,
    shadspotsize : Collada.ID.shadspotsize,
    shape : Collada.ID.shape,
    shininess : Collada.ID.shininess,
    skeleton : Collada.ID.skeleton,
    skew : Collada.ID.skew,
    skin : Collada.ID.skin,
    sky_colorspace : Collada.ID.sky_colorspace,
    sky_exposure : Collada.ID.sky_exposure,
    skyblendfac : Collada.ID.skyblendfac,
    skyblendtype : Collada.ID.skyblendtype,
    soft : Collada.ID.soft,
    source : Collada.ID.source,
    specular : Collada.ID.specular,
    sphere : Collada.ID.sphere,
    spline : Collada.ID.spline,
    spot : Collada.ID.spot,
    spotblend : Collada.ID.spotblend,
    spotsize : Collada.ID.spotsize,
    spread : Collada.ID.spread,
    sun_brightness : Collada.ID.sun_brightness,
    sun_effect_type : Collada.ID.sun_effect_type,
    sun_intensity : Collada.ID.sun_intensity,
    sun_size : Collada.ID.sun_size,
    surface : Collada.ID.surface,
    tapered_capsule : Collada.ID.tapered_capsule,
    tapered_cylinder : Collada.ID.tapered_cylinder,
    targets : Collada.ID.targets,
    technique : Collada.ID.technique,
    technique_common : Collada.ID.technique_common,
    translate : Collada.ID.translate,
    transparent : Collada.ID.transparent,
    transparency : Collada.ID.transparency,
    triangles : Collada.ID.triangles,
    trifans : Collada.ID.trifans,
    tristrips : Collada.ID.tristrips,
    type : Collada.ID.type,
    unit : Collada.ID.unit,
    up_axis : Collada.ID.up_axis,
    v : Collada.ID.v,
    vcount : Collada.ID.vcount,
    vertex_weights : Collada.ID.vertex_weights,
    vertices : Collada.ID.vertices,
    visual_scene : Collada.ID.visual_scene,
    xfov : Collada.ID.xfov,
    yfov : Collada.ID.yfov,
    zfar : Collada.ID.zfar,
    znear : Collada.ID.znear,
    YF_dofdist : Collada.ID.YF_dofdist,
    shiftx : Collada.ID.shiftx,
    shifty : Collada.ID.shifty,
    ambient_diffuse_lock : Collada.ID.ambient_diffuse_lock,
    ambient_diffuse_texture_lock :  Collada.ID.ambient_diffuse_texture_lock,
    apply_reflection_dimming : Collada.ID.apply_reflection_dimming,
    diffuse_specular_lock : Collada.ID.diffuse_specular_lock,
    dim_level : Collada.ID.dim_level,
    extended_shader : Collada.ID.extended_shader,
    opacity_type : Collada.ID.opacity_type,
    reflection_level : Collada.ID.reflection_level,
    reflective : Collada.ID.reflective,
    shader : Collada.ID.shader,
    soften : Collada.ID.soften,
    source_data : Collada.ID.source_data,
    use_self_illum_color : Collada.ID.use_self_illum_color,
    wire_size : Collada.ID.wire_size,
    wire_units : Collada.ID.wire_units,
    };
  }

  constructor() {
    this.start_pos = 0;
    this.collada_text = "";
    this.OPEN  = 1;
    this.CLOSE = 2;
    this.EMPTY = 3;
    this.mesh_count = 0;
    this.current = 0;
    this.skin_count = 0;
    this.meshes = [];
    this.rootFrame = new Frame(null, "root");
    this.anim = new Animation("ColladaAnimation");
    this.printflag = false;
    this.effectColors = {};
    this.effectParams = {};
    this.materialEffects = {};
  }

  printf(fmt, ...arg) {
    if (this.printflag) {
      util.printf(fmt, ...arg);
    }
  }

  getMeshes() {
    return this.meshes;
  }

  getMeshCount() {
    return this.mesh_count;
  }

  releaseMeshes() {
    this.meshes = [];
    this.mesh_count = 0;
  }

  getMaterialColor(materialId) {
    if (!materialId) return null;
    const effectId = this.materialEffects[materialId];
    if (!effectId) return null;
    return this.effectColors[effectId] ?? null;
  }

  getMaterialParams(materialId) {
    if (!materialId) return null;
    const effectId = this.materialEffects[materialId];
    if (!effectId) return null;
    return this.effectParams[effectId] ?? null;
  }

  // パースに使う3種類の正規表現を RegExp のインスタンスとして準備
  // 正規表現を文字列で与える場合は"\"を"\\"にエスケープする
  setRegExp() {
    // <         < で始まり
    // \/?       closing_tag、 [1] / があるかもしれない
    // [\?\w]+   element_name、[2] すべての英数+ _ + ? の1回以上(最長)
    //                         空白や / や > で区切られる
    // .*?       attributes、  [3] すべての文字の0回以上の繰り返し(最短)
    // \/?       empty_tag、   [4] / があるかもしれない
    // >         > で終わる
    this.reTag = new RegExp("<(\\/?)([\\?\\w]+)(.*?)(\\/?)>","gm");

    // \w+   attribute_name、  [1] すべての英数+ _ の1回以上の繰返し(最長)
    //   =                     =
    // [\\"']   delim、        [2] \ " '
    // .*?      value、        [3]すべての文字の0回以上の繰り返し(最短)
    // \2                      2番目にキャプチャされた文字列で [%\"']
    this.reAttr = new RegExp("\\s?(\\w+)\\s?=\\s?([\\\"'])(.*?)\\2", "g");

    // [^\s<>]+   空白や < や > でない文字の1回以上の繰返し(最長)
    this.reData = new RegExp("[^\\s<>]+", "g");
  }

  // ----------------------------
  // タグとタグの間のテキストデータを空白や改行区切りで切り出し
  // 配列として返す終了タグからさかのぼって解析される
  parseText(string_to_parse) {
    let data = [];
    let result = string_to_parse.match(this.reData);
    for(let i=0; i<result.length; i++) {
      data.push(result[i]);
    }
    return data;
  }

  // ----------------------------
  // タグに含まれる属性名と値を取得して、複数の属性名と属性値の
  // オブジェクト(ハッシュ)を返す
  parseArgs(string_to_parse) {
    let arg = {};
    let result;
    while ((result = this.reAttr.exec(string_to_parse)) !== null) {
      let attribute_name = result[1];
      let value = result[3];
      arg[attribute_name] = value;
    }
    return arg;
  }

  // ----------------------------
  // 次のタグを検索して、タグの間のテキストとタグの要素と
  // 属性を解析するtag.elementNameは要素名, tag.type はタグの形式,
  // tag.args は属性の連想配列、tag.data は本文の空白区切り配列を返す
  getNextTag() {
    let closing_tag, element_name, attributes, empty_tag;
    let end_pos = 1;
    let tag_type;
    let tag = {};

    let result = this.reTag.exec(this.collada_text);
    if (result === null) { return null; }
    closing_tag = result[1];
    element_name = result[2];
    attributes = result[3];
    empty_tag = result[4];
    let find_pos = result.index;

    //this.printf("\n<%s%s%s>", closing_tag, element_name, empty_tag);

    if (element_name !== "?xml") {
      tag.element = Collada.elementName[element_name];
    }
    tag.elementName = element_name;
    end_pos = this.reTag.lastIndex - 1;
    let text = this.collada_text.slice(this.start_pos, find_pos);
    // 改行だけか、空白だけの行で無ければ
    if ((text !== null) && !text.match(/^\s*$/)) {
      tag.data = this.parseText(text);
      //for(let i=0; i<tag.data.length;i++) {
      //  this.printf("%f, ", tag.data[i]);
      //}
    }

    if (empty_tag === "/") {
        tag.type = this.EMPTY;
    } else if (closing_tag === "/") {
        tag.type = this.CLOSE;
    } else {
        tag.type = this.OPEN;
    }

    tag.args = this.parseArgs(attributes);
    //for(let key in tag.args) {
    //  this.printf(" %s = %s,", key, tag.args[key]);
    //}
    this.start_pos = end_pos + 1;
    return tag;
  }

  // ----------------------------
  // skip;
  // ----------------------------
  skip(tag) {
    let t;
    do {
      t = this.getNextTag();
      // タグが </tag> までスキップ
    } while ((t.element !== tag.element) || (t.type !== this.CLOSE));
  }

  skipToClosingTag(element) {
    let tag;
    let stack = new Stack();
    stack.push(element);
    do {
      tag = this.getNextTag();
      if (tag.type === this.OPEN) {
        stack.push(tag.element);
      } else if (tag.type === this.CLOSE) {
        if (stack.top() === tag.element) {
          stack.pop();
        } else {
          util.printf("Error : closing %s\n", tag.elementName);
          throw new Error();
        }
      }
    } while ((element !== tag.element) || (tag.type !== this.CLOSE));
  }

  // ----------------------------
  // <asset>;
  // ----------------------------
  asset(tag) {
    if (tag.type === this.EMPTY) { return; }
    this.skipToClosingTag(Collada.ID.asset);
  }

  // ----------------------------
  // <library_cameras>;
  // ----------------------------
  library_cameras(tag) {
    if (tag.type === this.EMPTY) { return; }
    this.skipToClosingTag(Collada.ID.library_cameras);
  }

  // ----------------------------
  // <library_lights>;
  // ----------------------------
  library_lights(tag) {
    if (tag.type === this.EMPTY) { return; }
    this.skipToClosingTag(Collada.ID.library_lights);
  }

  // ----------------------------
  // <library_images>;
  // ----------------------------
  library_images(tag) {
    if (tag.type === this.EMPTY) { return; }
    this.skipToClosingTag(Collada.ID.library_images);
  }

  // ----------------------------
  // <library_effects>;
  // ----------------------------
  library_effects(tag) {
    if (tag.type === this.EMPTY) { return; }
    let t;
    let currentEffect = null;
    let inDiffuse = false;
    let inAmbient = false;
    let inSpecular = false;
    let inShininess = false;
    do {
      t = this.getNextTag();
      if ((t.element === Collada.ID.effect) && (t.type === this.OPEN)) {
        currentEffect = t.args.id ?? null;
        if (currentEffect && !this.effectParams[currentEffect]) {
          this.effectParams[currentEffect] = {};
        }
      } else if ((t.element === Collada.ID.effect) && (t.type === this.CLOSE)) {
        currentEffect = null;
      } else if ((t.element === Collada.ID.diffuse) && (t.type === this.OPEN)) {
        inDiffuse = true;
      } else if ((t.element === Collada.ID.diffuse) && (t.type === this.CLOSE)) {
        inDiffuse = false;
      } else if ((t.element === Collada.ID.ambient) && (t.type === this.OPEN)) {
        inAmbient = true;
      } else if ((t.element === Collada.ID.ambient) && (t.type === this.CLOSE)) {
        inAmbient = false;
      } else if ((t.element === Collada.ID.specular) && (t.type === this.OPEN)) {
        inSpecular = true;
      } else if ((t.element === Collada.ID.specular) && (t.type === this.CLOSE)) {
        inSpecular = false;
      } else if ((t.element === Collada.ID.shininess) && (t.type === this.OPEN)) {
        inShininess = true;
      } else if ((t.element === Collada.ID.shininess) && (t.type === this.CLOSE)) {
        inShininess = false;
      } else if ((t.element === Collada.ID.color) && (t.type === this.CLOSE)) {
        if (currentEffect && t.data) {
          const c = t.data.map((v) => parseFloat(v));
          const r = c[0] ?? 1.0;
          const g = c[1] ?? r;
          const b = c[2] ?? r;
          const a = c[3] ?? 1.0;
          if (inDiffuse) {
            this.effectColors[currentEffect] = [r, g, b, a];
            this.effectParams[currentEffect].diffuse = [r, g, b, a];
          } else if (inAmbient) {
            this.effectParams[currentEffect].ambient = [r, g, b, a];
          } else if (inSpecular) {
            this.effectParams[currentEffect].specular = [r, g, b, a];
          }
        }
      } else if ((t.element === Collada.ID.float) && (t.type === this.CLOSE)) {
        if (inShininess && currentEffect && t.data) {
          const v = parseFloat(t.data[0]);
          if (!Number.isNaN(v)) {
            this.effectParams[currentEffect].shininess = v;
          }
        }
      }
    } while ((t.element !== Collada.ID.library_effects) || (t.type !== this.CLOSE));
  }

  // ----------------------------
  // <library_materials>;
  // ----------------------------
  library_materials(tag) {
    if (tag.type === this.EMPTY) { return; }
    let t;
    let currentMaterial = null;
    do {
      t = this.getNextTag();
      if ((t.element === Collada.ID.material) && (t.type === this.OPEN)) {
        currentMaterial = t.args.id ?? null;
      } else if ((t.element === Collada.ID.material) && (t.type === this.CLOSE)) {
        currentMaterial = null;
      } else if ((t.element === Collada.ID.instance_effect) &&
                 ((t.type === this.EMPTY) || (t.type === this.OPEN))) {
        if (currentMaterial && t.args.url) {
          const effectId = t.args.url.startsWith("#") ? t.args.url.slice(1) : t.args.url;
          this.materialEffects[currentMaterial] = effectId;
        }
      }
    } while ((t.element !== Collada.ID.library_materials) || (t.type !== this.CLOSE));
  }

  // ----------------------------
  // <source>;
  // ----------------------------
  getNumList(tag_id) {
    let data_list = [];
    let t = this.getNextTag();
    if ((t.element === tag_id) && (t.type === this.CLOSE)) {
      for (let i=0; i<t.data.length; i++) {
        data_list.push(parseFloat(t.data[i]));
      }
    }
    return data_list;
  }

  getList(tag_id) {
    let data_list;
    let t = this.getNextTag();
    if ((t.element === tag_id) && (t.type === this.CLOSE)) {
      data_list = t.data;
    }
    return data_list;
  }

  source() {
    let t;
    let data_list = [];
    do {
      t = this.getNextTag();
      if (t.element === Collada.ID.float_array) {
        if (t.type !== this.EMPTY) {
          data_list = this.getNumList(Collada.ID.float_array);
          this.printf("float_array: %d floats\n", data_list.length);
        } else {
          data_list = [];
        }
      } else if (t.element === Collada.ID.Name_array) {
        if (t.type !== this.EMPTY) {
          data_list = this.getList(Collada.ID.Name_array);
          this.printf("Name_array: %d words\n", data_list.length);
        } else {
          data_list = [];
        }
      } else if (t.element === Collada.ID.technique_common) {
        t = this.getNextTag();
        if (t.element === Collada.ID.accessor) {
          do {
            t = this.getNextTag();
            if (t.element === Collada.ID.param) {
              this.printf("<param name=%s>\n", t.args.name);
            }
          } while ((t.element !== Collada.ID.accessor)||(t.type !== this.CLOSE));
        }
        t = this.getNextTag();
        if (t.element === Collada.ID.technique_common) {
          if (t.type !== 2) {
            util.printf("Error : expect </technique_common>, found <%s>\n",
                        t.elementName);
            throw new Error();
          }
        }
      }
    } while ((t.element !== Collada.ID.source) || (t.type !== this.CLOSE));
    return data_list;
  }

  getPolygonData(p, pointer, data_count) {
    let position, normal, tex_uv1, tex_uv2, tex_uv3, color;
    if (data_count === 6) {
      position = p[pointer + 0];
      normal   = p[pointer + 1];
      tex_uv1  = p[pointer + 2];
      tex_uv2  = p[pointer + 3];
      tex_uv3  = p[pointer + 4];
      color    = p[pointer + 5];
      return [position, normal, tex_uv1, tex_uv2, tex_uv3, color];
    } else if (data_count === 5) {
      position  = p[pointer + 0];
      normal    = p[pointer + 1];
      tex_uv1   = p[pointer + 2];
      tex_uv2   = p[pointer + 3];
      color     = p[pointer + 4];
      return [position, normal, tex_uv1, tex_uv2, color];
    } else if (data_count === 4) {
      position = p[pointer + 0];
      normal   = p[pointer + 1];
      tex_uv1  = p[pointer + 2];
      color    = p[pointer + 3];
      return [position, normal, tex_uv1, color];
    } else if (data_count === 3) {
      position = p[pointer + 0];
      normal   = p[pointer + 1];
      tex_uv1  = p[pointer + 2];
      return [position, normal, tex_uv1];
    } else if (data_count === 2) {
      position = p[pointer + 0];
      normal   = p[pointer + 1];
      return [position, normal];
    } else if (data_count === 1) {
      position = p[pointer + 0];
      return [position];
    }
  }

  // ----------------------------
  // <mesh>;
  // ----------------------------
  geo_mesh(id) {
    let t;
    let find;
    let positions, normals, texture_uvs, colors;
    let textures = [];
    let polygons = [];
    this.mesh_count = this.mesh_count + 1;
    this.current = this.mesh_count - 1;
    this.meshes.push(new Mesh(null));
    let mesh = this.meshes[this.current];
    mesh.setName(id);

    do {
      t = this.getNextTag();

      if (t.element === Collada.ID.source) {
        this.printf("<%s id=%s\n", t.elementName, t.args.id);
        //find_pos = t.args.id.match(/-position/);
        find = new RegExp(/-position/).exec(t.args.id);
        if (find !== null) {
          positions = this.source();
        } else {
          find = new RegExp(/-normal/).exec(t.args.id);
          if (find !== null) {
            normals = this.source();
          } else {
            find = new RegExp(/-color/).exec(t.args.id);
            if (find !== null) {
              colors = this.source();
            } else {
              find = new RegExp(/-map/).exec(t.args.id);
              if (find === null) {
                find = new RegExp(/-uv/).exec(t.args.id);
              }
              if (find !== null) {
                texture_uvs = this.source();
                textures.push(texture_uvs);
              }
            }
          }
        }

      } else if (t.element === Collada.ID.vertices) {
        this.printf("<%s>\n", t.elementName);
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.input) && (t.type === this.EMPTY)) {
            this.printf("<%s semantic=%s>\n", t.elementName, t.args.semantic);
          }
        } while ((t.element !== Collada.ID.vertices)||(t.type !== this.CLOSE));

      } else if (t.element === Collada.ID.polylist) {
        if (t.args?.material) {
          mesh.setMaterialId?.(t.args.material);
        }
        let max_offset = 0;
        let offset;
        let vcount, p;
        let input_count = 0;
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.input) && (t.type === this.EMPTY)) {
            offset = Number(t.args.offset);
            this.printf("<%s semantic=%s offset=%d>\n",
                         t.elementName, t.args.semantic, offset);
            input_count = input_count + 1;
            if (offset > max_offset) { max_offset = offset; }
          } else if ((t.element === Collada.ID.vcount)&&(t.type === this.OPEN)) {
            vcount = this.getNumList(Collada.ID.vcount);
          } else if ((t.element === Collada.ID.p) && (t.type === this.OPEN)) {
            p = this.getNumList(Collada.ID.p);
          }
        } while ((t.element !== Collada.ID.polylist)||(t.type !== this.CLOSE));
        let vcount_sum = 0;
        let stride = max_offset + 1;
        for (let i = 0; i<vcount.length; i++) {
          let polygon = [];
          for (let k = 0; k<vcount[i]; k++) {
            let data = this.getPolygonData(p, vcount_sum + k * stride, stride);
            polygon.push(data);
          }
          vcount_sum = vcount_sum + (vcount[i] * stride);
          polygons.push(polygon);
        }
        this.printf("<polylist> input=%d vertices=%d polygons=%d\n",
                     input_count, vcount.length, polygons.length);

      } else if (t.element === Collada.ID.triangles) {
        if (t.args?.material) {
          mesh.setMaterialId?.(t.args.material);
        }
        this.printf("<%s>\n", t.elementName);
        let max_offset = 0;
        let offset;
        let p;
        let input_count = 0;
        let triangle_count = Number(t.args?.count ?? 0);
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.input) && (t.type === this.EMPTY)) {
            offset = Number(t.args.offset);
            this.printf("<%s semantic=%s offset=%d>\n",
                        t.elementName, t.args.semantic, offset);
            input_count = input_count + 1;
            if (offset > max_offset) { max_offset = offset; }
          } else if ((t.element === Collada.ID.p) && (t.type === this.OPEN)) {
            p = this.getNumList(Collada.ID.p);
          } else if ((t.element === Collada.ID.p) && (t.type === this.EMPTY)) {
            p = [];
          }
        } while ((t.element !== Collada.ID.triangles)||(t.type !== this.CLOSE));
        let vcount_sum = 0;
        let stride = max_offset + 1;
        if (!Number.isFinite(triangle_count) || triangle_count <= 0) {
          triangle_count = Math.floor((p?.length ?? 0) / (stride * 3));
        }
        for (let i = 0; i<triangle_count; i++) {
          let polygon = [];
          for (let k = 0; k<3; k++) {
            let data = this.getPolygonData(p, vcount_sum + k*stride, stride);
            polygon.push(data);
          }
          vcount_sum = vcount_sum + stride * 3;
          polygons.push(polygon);
        }
        this.printf("<triangles> input=%d vertices=%d polygons=%d\n",
                    input_count, vcount_sum, polygons.length);

      } else if (t.element === Collada.ID.lines) {
        this.skipToClosingTag(Collada.ID.lines);
      } else if (t.element === Collada.ID.linestrips) {
        this.skipToClosingTag(Collada.ID.linestrips);
      } else {
        if (t.type !== this.CLOSE) {
          util.printf("Error : <%s>\n", t.elementName);
          throw new Error();
        }
      }
    } while ((t.element !== Collada.ID.mesh)||(t.type !== this.CLOSE));

    mesh.setName(id);
    if (positions.length > 0) mesh.setVertices(positions);
    if (normals.length   > 0) mesh.setNormals(normals);
    if (textures.length  > 0) mesh.setTextureCoord(textures);
    if (polygons.length  > 0) mesh.setPolygons(polygons);

  }

  // ----------------------------
  // <extra>;
  // ----------------------------
  extra(tag) {
    let t;
    this.printf("<%s>\n", tag.elementName);
    do {
      t = this.getNextTag();
      this.printf("<%s>\n", t.elementName);
    } while ((t.element !== Collada.ID.extra)||(t.type !== this.CLOSE));
  }

  // ----------------------------
  // <library_geometries>;
  // ----------------------------
  library_geometries(tag) {
    let t;
    let geo_id;
    if (tag.type === this.EMPTY) { return; }
    do {
      t = this.getNextTag();
      if ((t.element === Collada.ID.geometry) && (t.type === this.OPEN)) {
        geo_id = t.args.id;
        t = this.getNextTag();
        if (t.element === Collada.ID.mesh) {
           this.geo_mesh(geo_id);
        } else if (t.element === Collada.ID.extra) {
           this.extra(t);
        } else if (t.element === Collada.ID.geometry) {
          if (t.type !== this.CLOSE) {
            util.printf("Error : <%s>\n", t.elementName);
            throw new Error();
          }
        }
      }
    } while ((t.element !== Collada.ID.library_geometries)||(t.type !== this.CLOSE));
  }

  // ----------------------------
  // <skin>;
  // ----------------------------
  controller_skin(source_name) {
    let t;
    let find_pos;
    let joint_names, bind_poses, skin_weights;
    let vcount, v;
    let bind_shape_matrix = new Matrix();
    this.skin_count = this.skin_count + 1;

    do {
      t = this.getNextTag();

      if (t.element === Collada.ID.source) {
        find_pos = t.args.id.match(/-skin\d*-joints$/);
        if (find_pos !== null) {
          joint_names = this.source();
        } else {
          find_pos = t.args.id.match(/-skin\d*-bind_poses$/);
          if (find_pos !== null) {
            bind_poses = this.source();
          } else {
            find_pos = t.args.id.match(/-skin\d*-weights$/);
            if (find_pos !== null) {
              skin_weights = this.source();
            }
          }
        }

      } else if ((t.element === Collada.ID.bind_shape_matrix )
                  && (t.type === this.OPEN)) {
        bind_shape_matrix.setBulk(this.getNumList(Collada.ID.bind_shape_matrix));
        bind_shape_matrix.transpose();
        this.printf("<%s>\n", t.elementName);
        if (this.printflag) {
          util.printf(bind_shape_matrix.sprint("", "f"));
        }
      } else if (t.element === Collada.ID.joints) {
        this.printf("<%s>\n", t.elementName);
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.input) && (t.type === this.EMPTY)) {
            this.printf("<%s semantic=%s>\n", t.elementName, t.args.semantic);
          }
        } while ((t.element !== Collada.ID.joints)||(t.type !== this.CLOSE));

      } else if (t.element === Collada.ID.vertex_weights) {
        this.printf("<%s>\n", t.elementName);
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.input) && (t.type === this.EMPTY)) {
            this.printf("<%s semantic=%s>\n", t.elementName, t.args.semantic);
          } else if ((t.element === Collada.ID.vcount) && (t.type === this.OPEN)) {
            vcount = this.getNumList(Collada.ID.vcount);
          } else if ((t.element === Collada.ID.v) && (t.type === this.OPEN)) {
            v = this.getNumList(Collada.ID.v);
          }
        } while ((t.element !== Collada.ID.vertex_weights)||(t.type !== this.CLOSE));

      } else {
        if (t.type !== this.CLOSE) {
          util.printf("Error : <%s>\n", t.elementName);
          throw new Error();
        }
      }
    } while ((t.element !== Collada.ID.skin)||(t.type !== this.CLOSE));

    let skinweights = [];
    if (vcount.length > 0) {
      let index = 0;
      for (let i=0; i<vcount.length; i++) {
        let temp = [];
        for (let j=0; j<vcount[i]; j++) {
          // v = { bone_idx, sw_idx, bone_idx, sw_idx, .. }
          temp.push(v[index * 2]);  // bone index  // 2016/08/12
          temp.push(skin_weights[ v[index * 2 + 1] ]); // 2016/08/12
          index = index + 1;
        }
        skinweights.push(temp);
      }
      for (let i=0; i<this.mesh_count; i++) {
        let id_name = "#" + this.meshes[i].getName();
        if (source_name === id_name) {
          // found;
          this.meshes[i].setSkinWeights(skinweights);
          this.meshes[i].setJointNames(joint_names);
          let bindPoseMatrices = [];
          for (let n=0; n<joint_names.length; n++) {
             let m = new Matrix();
             let tmp = [];
             for (let j=0; j<16; j++) {
               tmp.push(bind_poses[n * 16 + j]);
             }
             m.setBulk(tmp);
             m.transpose() // inverse bind-pose matrix;
             bindPoseMatrices.push(m);
          }
          this.meshes[i].setBindPoseMatrices( bindPoseMatrices );
          this.meshes[i].setBindShapeMatrix(bind_shape_matrix);
          break;
        }
      }
    }
  }

  // ----------------------------
  // <library_controllers>;
  // ----------------------------
  library_controllers(tag) {
    let t;
    if (tag.type === this.EMPTY) { return; }
    do {
      t = this.getNextTag();
      if ((t.element === Collada.ID.controller) && (t.type === this.OPEN)) {
        this.printf("<controller id=%s>\n", t.args.id);
        t = this.getNextTag();
        if ((t.element === Collada.ID.skin) && (t.type === this.OPEN)) {
           this.controller_skin(t.args.source);
        } else if (t.element === Collada.ID.controller) {
          if (t.type !== this.CLOSE) {
            util.printf("Error : <%s>\n", t.elementName);
            throw new Error();
          }
        }
      }
    } while ((t.element !== Collada.ID.library_controllers)||(t.type !== this.CLOSE));
  }

  // ----------------------------
  // <node>;
  // ----------------------------
  node(tag, parent_frame) {
    let t;
    // Object
    let node_name = tag.args.id + "-mesh";
    for (let i=0; i<this.mesh_count; i++) {
      if (node_name === this.meshes[i].getName()) {
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.matrix) && (t.type === this.OPEN)) {
            // node let matrix
            let mat = new Matrix();
            let m = this.getNumList(Collada.ID.matrix);
            mat.setBulk(m);
            mat.transpose();
            this.printf("Object Node \n");
            if (this.printflag) {
               mat.print_verbose()
            }
            this.meshes[i].setNodeMatrix(mat);
          } else if ((t.element === Collada.ID.instance_geometry) && (t.type === this.OPEN)) {
            // skip
            this.skipToClosingTag(Collada.ID.instance_geometry);
          }
        } while ((t.element !== Collada.ID.node) || (t.type !== this.CLOSE));
        return;
      }
    }
    // Bone
    let frame = new Frame(parent_frame, tag.args.id, tag.args.sid, tag.args.name);
    frame.setType(tag.args.type);
    do {
      t = this.getNextTag();
      if ((t.element === Collada.ID.matrix) && (t.type === this.OPEN)) {
        // node let matrix;
        let mat = new Matrix();
        let m = this.getNumList(Collada.ID.matrix);
        mat.setBulk(m);
        mat.transpose();
        if (this.printflag) {
           mat.print_verbose()
        }
        frame.setByMatrix(mat);
      } else if ((t.element === Collada.ID.translate) && (t.type === this.OPEN)) {
        this.getNumList(Collada.ID.translate);
      } else if ((t.element === Collada.ID.rotate) && (t.type === this.OPEN)) {
        this.getNumList(Collada.ID.rotate);
      } else if ((t.element === Collada.ID.scale) && (t.type === this.OPEN)) {
        this.getNumList(Collada.ID.scale);
      } else if ((t.element === Collada.ID.node) && (t.type === this.OPEN)) {
        this.printf("<node id=%s type=%s>\n", t.args.id, t.args.type);
        this.node(t, frame);
      } else if ((t.element === Collada.ID.instance_controller)
                  && (t.type === this.OPEN)) {
        do {
          t = this.getNextTag();
          if ((t.element === Collada.ID.skeleton) && (t.type === this.OPEN)) {
            this.getList(Collada.ID.skeleton);
          } else if ((t.element === Collada.ID.bind_material) && (t.type === this.OPEN)) {
            // skip;
            this.skipToClosingTag(Collada.ID.bind_material);
          }
        } while ((t.element !== Collada.ID.instance_controller)||(t.type !== this.CLOSE));
      }
    } while ((t.element !== Collada.ID.node)||(t.type !== this.CLOSE));
  }

  // ----------------------------
  // <library_visual_scenes>;
  // ----------------------------
  library_visual_scenes(tag) {
    let t;
    if (tag.type === this.EMPTY) { return; }
    t = this.getNextTag();
    if ((t.element === Collada.ID.visual_scene) && (t.type === this.OPEN)) {
      this.printf("<v_scene id=\"%s\" type=\"%s\">\n", t.args.id, t.args.type)
      do {
        t = this.getNextTag();
        if (t.element === Collada.ID.node) {
           this.printf("<node id=%s type=%s>\n", t.args.id, t.args.type);
           this.node(t, this.rootFrame);
        } else if (t.element === Collada.ID.visual_scene) {
          if (t.type !== this.CLOSE) {
            util.printf("Error : <%s>\n", t.elementName);
            throw new Error();
          }
        }
      } while ((t.element !== Collada.ID.library_visual_scenes)||(t.type !== this.CLOSE));
    }
  }

  checkAnimationType(id) {
    let found, axis;
    let type = 0; // 0:position, 1:rotation, 2:matrix, 3:scale
    found = id.match(/location[\_\.](\c)-output/);
    if (found === null) {
      found = id.match(/euler[\_\.](\c)-output/);
      if (found === null) {
        found = id.match(/scale[\_\.](\c)-output/);
        if (found === null) {
          found = id.match(/matrix-output/);
          if (found === null) {
            return null;
          } else {
            return [2, found[1]]; // [matrix, axis]
          }
        } else {
          return [3, found[1]]; // [scale, axis]
        }
      } else {
        return [1, found[1]]; // [rotation, axis]
      }
    }
    return [0, found[1]]      // [position, axis]
  }

  // ----------------------------
  // <animation>;
  // ----------------------------
  parseAnimationTargetName(target, fallback_name) {
    // channel target は "Armature_Bone_001/transform" のような形になる
    // Collada の animation id よりこちらの方が対象 joint を直接表すため、
    // nested animation を平坦化する時の track 名として優先する
    if ((target === undefined) || (target === null)) {
      return fallback_name;
    }
    let bone_name = target.split("/")[0];
    if ((bone_name === undefined) || (bone_name === "")) {
      return fallback_name;
    }
    return bone_name;
  }

  animation(tag, parent) {
    let t;
    let found;
    let times = [];
    let output = [];
    let bone_name;
    let kind = null;
    let axis = null;
    let tracks = [];
    let anim_id = tag.args.id;
    this.printf("<animation id=%s type=%s>\n", anim_id, tag.args.type);
    if (tag.args.id !== null) {
      let reBone = new RegExp("Armature[\\d_]+(\\w+)_pose_matrix$");
      let result = reBone.exec(anim_id);
      bone_name = result ? result[1] : anim_id;
    }
    do {
      t = this.getNextTag();
      if (t.element === Collada.ID.source) {
        found = new RegExp(/-input/).exec(t.args.id);
        if (found !== null) {
          times = this.source();
        } else {
          found = new RegExp(/-output/).exec(t.args.id);
          if (found !== null) {
            [kind, axis] = this.checkAnimationType(t.args.id);
            output = this.source();
          } else { // other sources are ignored.;
            this.skipToClosingTag(Collada.ID.source);
          }
        }
      } else if ((t.element === Collada.ID.sampler) && (t.type === this.OPEN)) {
        if (t.type !== this.EMPTY) {
          this.skipToClosingTag(Collada.ID.sampler);
        }
      } else if (t.element === Collada.ID.channel) {
        bone_name = this.parseAnimationTargetName(t.args.target, bone_name);
        if (t.type !== this.EMPTY) {
          this.skipToClosingTag(Collada.ID.channel);
        }
      } else if ((t.element === Collada.ID.asset) && (t.type === this.OPEN)) {
        this.asset(t);
      } else if ((t.element === Collada.ID.extra) && (t.type === this.OPEN)) {
        this.extra(t);
      } else if ((t.element === Collada.ID.animation) && (t.type === this.OPEN)) {
        // Blender 由来の Collada は <animation> が入れ子になっており、
        // 外側の container 自体は source を持たない
        // 子 animation の track をここで平坦化しないと times/output が空のままになる
        tracks.push(...this.animation(t, parent));
      }
    } while ((t.element !== Collada.ID.animation)||(t.type !== this.CLOSE));

    if ((times.length > 0) || (output.length > 0) || (kind !== null)) {
      tracks.push([times, output, kind, axis, bone_name]);
    }
    return tracks;
  }

  // ----------------------------
  // <library_animations>;
  // ----------------------------
  library_animations(tag) {
    let t;
    let times=[], output=[], bone_name=[];
    let kind = null;
    let axis = null;
    let anim = this.anim;

    if (tag.type === this.EMPTY) { return; }
    do {
      t = this.getNextTag();
      if ((t.element === Collada.ID.animation) && (t.type === this.OPEN)) {
        let loc, rot, scale;
        if (t.args.id !== null) {
          loc = new RegExp("_location").exec(t.args.id);
          rot = new RegExp("_rotation_euler").exec(t.args.id);
          scale = new RegExp("_scale").exec(t.args.id);
        }
        if ((loc !== null) || (rot !== null) || (scale !== null)) {
          this.skipToClosingTag(Collada.ID.animation);
        } else {
          let tracks = this.animation(t, null);
          for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
            let bone_poses = [];
            [times, output, kind, axis, bone_name] = tracks[trackIndex];
            this.printf("%s #key = %s, #output = %s, type:%s, axis:%s\n",
                         bone_name, times.length, output.length, kind, axis);
            // pose_matrix track だけを Animation へ入れる
            if (kind !== 2) { continue; }
            if (times.length === 0) { continue; }
            for (let i=0; i<times.length; i++) {
              let mat = new Matrix();
              mat.setBulkWithOffset(output, i * 16);
              mat.transpose();
              bone_poses.push(mat);
            }
            if ((anim.times.length === 0) || (anim.times.length === times.length)) {
              anim.setTimes(times);
            }
            anim.addBoneName(bone_name);
            anim.setBonePoses(bone_poses);
          }
        }
      } else if (t.element === Collada.ID.animation) {
        if (t.type !== this.CLOSE) {
          util.printf("Error : <%s>\n", t.elementName);
          throw new Error();
        }
      } else if ((tag.element === Collada.ID.asset) && (tag.type === this.OPEN)) {
        this.asset(tag);
      } else if (t.element === Collada.ID.extra) {
        this.extra(t);
      }
    } while ((t.element !== Collada.ID.library_animations)||(t.type !== this.CLOSE));
  }

  // ----------------------------
  // <scene>;
  // ----------------------------
  scene(tag) {
    if (tag.type === this.EMPTY) { return; }
    this.skipToClosingTag(Collada.ID.scene);
  }

  getAnimation() {
    return this.anim;
  }

  // ----------------------------
  // parse;
  // ----------------------------
  parse(text, verbose, output) {
    let stack = new Stack();
    // let tree = {}
    let data;
    let context;
    let skipElement = false;
    let tag;

    this.printflag = verbose;

    this.collada_text = text;
    this.setRegExp();
    tag = this.getNextTag();
    if (tag.elementName !== "?xml") {
      util.printf("Error : The file is not XML format.\n");
      return false;
    }
    tag = this.getNextTag();
    if (tag.element !== Collada.ID.COLLADA) {
      util.printf("Error : The file is not COLLADA format.\n");
      return false;
    }

    do {
      tag = this.getNextTag();
      if (tag.element === Collada.ID.asset) {
        this.asset(tag);
      } else if (tag.element === Collada.ID.library_cameras) {
        this.library_cameras(tag);
      } else if (tag.element === Collada.ID.library_lights) {
        this.library_lights(tag);
      } else if (tag.element === Collada.ID.library_images) {
        this.library_images(tag);
      } else if (tag.element === Collada.ID.library_effects) {
        this.library_effects(tag);
      } else if (tag.element === Collada.ID.library_materials) {
        this.library_materials(tag);
      } else if (tag.element === Collada.ID.library_geometries) {
        this.library_geometries(tag);
      } else if (tag.element === Collada.ID.library_controllers) {
        this.library_controllers(tag);
      } else if (tag.element === Collada.ID.library_visual_scenes) {
        this.library_visual_scenes(tag);
      } else if (tag.element === Collada.ID.library_animations) {
        this.library_animations(tag);
      } else if (tag.element === Collada.ID.scene) {
        this.scene(tag);
      } else {
        if (tag.element !== Collada.ID.COLLADA) {
          util.printf("Error : find <%s>\n", tag.elementName);
          return false;
        }
      }
    } while ((tag.element !== Collada.ID.COLLADA )||(tag.type !== this.CLOSE));
    return this.anim.close();
  }
};   // class Collada
