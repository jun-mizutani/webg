// ---------------------------------------------
// ResourceLedger.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水の所有labelでGPU資源を追跡し、通常PBR・検証readbackは別の所有区分で扱う

export default class ResourceLedger {
  // deviceへの呼出しを委譲するProxyを用意し、資源の生成・容量・破棄状態を記録する
  constructor(gpu) {
    this.resources = [];
    this.created = {};
    const device = new Proxy(gpu.device, {
      // 元objectのpropertyを取得し、deviceの操作は元のGPU資源へ委譲する
      get: (target, key) => {
        const value = target[key];
        if (typeof value !== "function") return value;
        if (!String(key).startsWith("create")) return value.bind(target);
        return (descriptor) => {
          const resource = value.call(target, descriptor);
          if (/water:|caustic:|:caustics/.test(descriptor?.label ?? "")) {
            this.created[key] = (this.created[key] ?? 0) + 1;
          }
          if (key === "createBuffer" || key === "createTexture" || key === "createQuerySet") {
            const size = descriptor.size;
            // 今回のformatと寸法から論理容量を計算する。ドライバ内部の配置やcache容量は別管理となる
            const texelBytes = { rgba16float: 8, rgba8unorm: 4,
              "rgba8unorm-srgb": 4, depth32float: 4, r32float: 4, rg16float: 4, rgba32float: 16 };
            const width = Array.isArray(size) ? size[0] : size?.width;
            const height = Array.isArray(size) ? (size[1] ?? 1) : (size?.height ?? 1);
            const depth = Array.isArray(size) ? (size[2] ?? 1) : (size?.depthOrArrayLayers ?? 1);
            const bytes = key === "createQuerySet" ? 0 : key === "createBuffer" ? size
              : width * height * depth * texelBytes[descriptor.format];
            const record = { kind: key, label: descriptor.label, bytes, alive: true };
            this.resources.push(record);
            const destroy = resource.destroy.bind(resource);
            resource.destroy = () => { record.alive = false; destroy(); };
          }
          return resource;
        };
      }
    });
    this.device = device;
    this.gpu = new Proxy(gpu, {
      // 元objectのpropertyを取得し、deviceの操作は元のGPU資源へ委譲する
      get: (target, key) => key === "device" ? device : target[key]
    });
  }

  // 生存中の専用資源を集計し、buffer・texture・QuerySetの個数と論理容量を返す
  snapshot() {
    const live = this.resources.filter(resource => resource.alive && /water:|caustic:|:caustics/.test(resource.label ?? ""));
    return {
      buffers: live.filter(resource => resource.kind === "createBuffer").length,
      textures: live.filter(resource => resource.kind === "createTexture").length,
      querySets: live.filter(resource => resource.kind === "createQuerySet").length,
      logicalBytes: live.reduce((sum, resource) => sum + resource.bytes, 0),
      created: { ...this.created }
    };
  }
}
