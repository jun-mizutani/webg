// ---------------------------------------------
//  PlaneCollider.js  2026/05/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collider from "./Collider.js";
import BoxCollider from "./BoxCollider.js";

export default class PlaneCollider extends Collider {

  // normal と offset を持つ plane collider を生成する
  constructor(normal, options = {}) {
    super("plane", options);
    this.normal = this._normalizeVec3(
      this._readVec3(normal, "PlaneCollider normal"),
      "PlaneCollider normal"
    );
  }

  // broadphase では plane 候補として扱う
  getBroadphaseKind() {
    return "plane";
  }

  // plane は box / sphere / capsule との候補だけを作る
  canBroadphasePairWith(otherCollider) {
    return otherCollider?.getBroadphaseKind?.() === "box"
      || otherCollider?.getBroadphaseKind?.() === "sphere"
      || otherCollider?.getBroadphaseKind?.() === "capsule";
  }

  // physics space 上の normal / point を返す
  getWorldInfo(position) {
    return {
      normal: [...this.normal],
      point: this.getWorldPosition(position)
    };
  }

  // ray と plane の交点を返す
  intersectRay(position, origin, dir, maxDistance = Infinity) {
    const plane = this.getWorldInfo(position);
    const rayOrigin = this._readVec3(origin, "PlaneCollider ray origin");
    const rayDir = this._readVec3(dir, "PlaneCollider ray dir");
    const denom = this._dotVec3(rayDir, plane.normal);
    if (Math.abs(denom) <= 1.0e-8) {
      return null;
    }
    const originToPlane = this._subVec3(plane.point, rayOrigin);
    const distance = this._dotVec3(originToPlane, plane.normal) / denom;
    if (distance < 0.0 || distance > maxDistance) {
      return null;
    }
    return {
      distance,
      position: this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance)),
      normal: denom < 0.0 ? [...plane.normal] : this._scaleVec3(plane.normal, -1.0)
    };
  }

  // plane-box 接触を生成する
  _buildContactWithBoxCollider(position, boxCollider, boxPosition, planeBody, boxBody, planeQuat = null, boxQuat = null) {
    if (!(boxCollider instanceof BoxCollider)) {
      throw new Error("PlaneCollider box contact requires a BoxCollider");
    }
    const plane = this.getWorldInfo(position);
    const box = boxCollider.getWorldInfo(boxPosition, boxQuat);
    const radius =
      Math.abs(this._dotVec3(plane.normal, box.axes[0])) * box.half[0] +
      Math.abs(this._dotVec3(plane.normal, box.axes[1])) * box.half[1] +
      Math.abs(this._dotVec3(plane.normal, box.axes[2])) * box.half[2];
    const centerToPlane = this._subVec3(box.center, plane.point);
    const distance = this._dotVec3(centerToPlane, plane.normal);
    const penetration = radius - distance;
    if (penetration <= 0.0) {
      return null;
    }
    // 床に対して box が広い面で近づいている場合は、
    // 頂点 1 個ではなく接触面に近い複数頂点を返す
    // これにより角 1 点だけで支えられたような解を減らし、
    // 面で寝る方向へ押し戻しやすくする
    const vertices = boxCollider.getVertices(boxPosition, boxQuat);
    let minVertexDistance = Infinity;
    const vertexDistances = [];
    for (let i = 0; i < vertices.length; i++) {
      const vertexDistance = this._dotVec3(
        this._subVec3(vertices[i], plane.point),
        plane.normal
      );
      vertexDistances.push(vertexDistance);
      if (vertexDistance < minVertexDistance) {
        minVertexDistance = vertexDistance;
      }
    }
    const contactTolerance = Math.max(
      0.012,
      Math.min(0.03, Math.max(box.half[0], box.half[1], box.half[2]) * 0.40)
    );
    const supportVertices = [];
    for (let i = 0; i < vertices.length; i++) {
      // 床 plane に対して「まだわずかに浮いている」頂点も、
      // tolerance 内なら support patch の一部として扱う
      // 細長い beam は傾き始めに 1 頂点だけが負距離になりやすく、
      // 他の近傍頂点を捨てると pivot 1 点で立ち上がる挙動を作りやすい
      if (vertexDistances[i] > contactTolerance) {
        continue;
      }
      if (vertexDistances[i] > minVertexDistance + contactTolerance) {
        continue;
      }
      const penetrationAtVertex = Math.max(0.0, -vertexDistances[i]);
      supportVertices.push({
        featureKey: `plane-box-vertex:${i}`,
        point: this._subVec3(vertices[i], this._scaleVec3(plane.normal, vertexDistances[i])),
        penetration: penetrationAtVertex
      });
    }
    if (supportVertices.length > 0) {
      if (supportVertices.length === 1) {
        return {
          bodyA: planeBody,
          bodyB: boxBody,
          normal: [...plane.normal],
          contacts: [{
            featureKey: supportVertices[0].featureKey,
            penetration: supportVertices[0].penetration,
            point: [...supportVertices[0].point]
          }]
        };
      }
      const fallbackAxis = Math.abs(plane.normal[1]) < 0.95
        ? [0.0, 1.0, 0.0]
        : [1.0, 0.0, 0.0];
      let tangentA = [
        fallbackAxis[1] * plane.normal[2] - fallbackAxis[2] * plane.normal[1],
        fallbackAxis[2] * plane.normal[0] - fallbackAxis[0] * plane.normal[2],
        fallbackAxis[0] * plane.normal[1] - fallbackAxis[1] * plane.normal[0]
      ];
      if (this._lengthVec3(tangentA) <= 1.0e-8) {
        tangentA = [
          -plane.normal[1],
          plane.normal[0],
          0.0
        ];
      }
      tangentA = this._normalizeVec3(tangentA, "PlaneCollider tangentA");
      const tangentB = this._normalizeVec3(
        [
          plane.normal[1] * tangentA[2] - plane.normal[2] * tangentA[1],
          plane.normal[2] * tangentA[0] - plane.normal[0] * tangentA[2],
          plane.normal[0] * tangentA[1] - plane.normal[1] * tangentA[0]
        ],
        "PlaneCollider tangentB"
      );
      const contacts = [];
      const pushUniqueContact = (vertex) => {
        if (!vertex) {
          return;
        }
        if (contacts.some((contact) => contact.featureKey === vertex.featureKey)) {
          return;
        }
        contacts.push({
          featureKey: vertex.featureKey,
          penetration: vertex.penetration,
          point: [...vertex.point]
        });
      };
      const pickExtremes = (tangent) => {
        let minVertex = supportVertices[0];
        let maxVertex = supportVertices[0];
        let minProjection = this._dotVec3(minVertex.point, tangent);
        let maxProjection = minProjection;
        for (let i = 1; i < supportVertices.length; i++) {
          const projection = this._dotVec3(supportVertices[i].point, tangent);
          if (projection < minProjection) {
            minProjection = projection;
            minVertex = supportVertices[i];
          }
          if (projection > maxProjection) {
            maxProjection = projection;
            maxVertex = supportVertices[i];
          }
        }
        pushUniqueContact(minVertex);
        pushUniqueContact(maxVertex);
      };
      pickExtremes(tangentA);
      pickExtremes(tangentB);
      if (contacts.length <= 0) {
        return {
          bodyA: planeBody,
          bodyB: boxBody,
          normal: [...plane.normal],
          contacts: [{
            featureKey: supportVertices[0].featureKey,
            penetration: supportVertices[0].penetration,
            point: [...supportVertices[0].point]
          }]
        };
      }
      return {
        bodyA: planeBody,
        bodyB: boxBody,
        normal: [...plane.normal],
        contacts
      };
    }
    const point = this._subVec3(box.center, this._scaleVec3(plane.normal, radius));
    return {
      bodyA: planeBody,
      bodyB: boxBody,
      normal: [...plane.normal],
      contacts: [{
        featureKey: "plane-box-center",
        penetration,
        point: this._addVec3(point, this._scaleVec3(plane.normal, penetration))
      }]
    };
  }

  // plane-sphere 接触を生成する
  _buildContactWithSphereCollider(position, sphereCollider, spherePosition, planeBody, sphereBody) {
    const plane = this.getWorldInfo(position);
    const sphere = sphereCollider.getWorldInfo(spherePosition);
    const centerToPlane = this._subVec3(sphere.center, plane.point);
    const distance = this._dotVec3(centerToPlane, plane.normal);
    const penetration = sphere.radius - distance;
    if (penetration <= 0.0) {
      return null;
    }
    const point = this._subVec3(sphere.center, this._scaleVec3(plane.normal, sphere.radius));
    return {
      bodyA: planeBody,
      bodyB: sphereBody,
      normal: [...plane.normal],
      penetration,
      point
    };
  }

  // plane-capsule 接触を生成する
  _buildContactWithCapsuleCollider(position, capsuleCollider, capsulePosition, planeBody, capsuleBody) {
    const plane = this.getWorldInfo(position);
    const capsule = capsuleCollider.getWorldInfo(capsulePosition);
    const distanceA = this._dotVec3(this._subVec3(capsule.pointA, plane.point), plane.normal);
    const distanceB = this._dotVec3(this._subVec3(capsule.pointB, plane.point), plane.normal);
    const distance = Math.min(distanceA, distanceB);
    const penetration = capsule.radius - distance;
    if (penetration <= 0.0) {
      return null;
    }
    const basePoint = distanceA <= distanceB ? capsule.pointA : capsule.pointB;
    const point = this._subVec3(basePoint, this._scaleVec3(plane.normal, capsule.radius));
    return {
      bodyA: planeBody,
      bodyB: capsuleBody,
      normal: [...plane.normal],
      penetration,
      point
    };
  }

};  // class PlaneCollider
