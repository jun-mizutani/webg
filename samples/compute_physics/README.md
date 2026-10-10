# compute_physics

[English](README.en.md) | 日本語

## 概要

`ComputePhysicsSpace`を使い、Box、Sphere、Capsuleの剛体をGPU上で更新して描画するサンプルです。72体のbody（各24体）を同じ物理空間へ登録し、3形状間と固定Planeの接触を一つのcombined solverで処理します。

Capsuleは球の上下半球と、その赤道リングを結ぶ円柱をlocal Y軸へ連結したmeshです。`ComputeCapsuleCollider`の半径・芯線長と同じ比率で描画し、Capsule同士／Sphere／Box／Plane接触も同じSpaceで処理します。

bodyの位置、姿勢、速度、停止状態は2本の`BodyState` Storage Bufferに保持されます。固定時間刻みごとにping-pongし、描画側は`getRenderState()`が返す現在のbufferをvertex shaderから直接読みます。個々の位置はGPU上で更新と描画を完結させます。

## 実行方法

実行ファイルは[./compute_physics.html](./compute_physics.html)です。WebGPU対応ブラウザで開くと、赤や青などで色分けしたBox、Sphere、Capsuleが境界枠の上部から落下し、床上で衝突しながら積み重なります。画面左上のpanelは初期状態では畳まれているため、bodyの動きを広く確認できます。

通常のrelease起動と`?debug=1`によるdebug起動は、アプリ側のGPU validation scopeを開始せずにresourceを生成します。`?debug=1`ではDebugDockを表示して、起動後の状態や処理結果を確認できます。GPU自体のvalidationはWebGPUが実行しますが、このサンプルは起動時にscopeを待機してエラーを収集しません。

CPU版との比較には[./compute_physics_cpu.html](./compute_physics_cpu.html)を使います。このページは通常の`PhysicsSpace`へ同じ72体を`PhysicsNode`として登録し、CPU物理とscene graph描画を実行します。両ページは[./computePhysicsScenario.js](./computePhysicsScenario.js)から同じ初期位置、姿勢、速度、形状寸法、材質、5枚の境界Planeを読みます。

## CPU版とCompute版の比較

二つのページは同じbody配置から開始するため、落下、形状同士の接触、床と壁による支持、摩擦、反発、停止状態を見比べられます。`R`で両ページをそれぞれ再読み込みすると同じ初期配置へ戻ります。GPUとCPUでは接触を評価する順序と丸めが異なるため、比較するのは、bodyが境界の内側に保たれること、接触後に有限値のまま動くこと、落ち着いたbodyがsleepへ移ることを確認します。

速度表示の単位はbackendの処理範囲に合わせています。Compute版のpanelには`GPU compute`、`GPU render`、`GPU total`、`JS time`が表示されます。CPU版には`CPU physics`として直近30回のfixed step計測値の中央値が表示され、同時に`JS time`と`GPU render`も確認できます。最初の数秒はGPU pipeline生成やブラウザのwarming upが含まれるため、速度を比較するときは両ページを同じブラウザ・同じ表示サイズで起動し、表示が安定してから複数回の値を読み取ります。異なるGPUやブラウザ間の値は、同じ環境内での相対比較として扱います。

CPU版は通常の`PhysicsSpace`を入口とし、`CpuMixedPhysicsPipeline`が全dynamic bodyを一fixed stepにつき一度だけ積分します。その後の各solver反復では、Box/BoxとPlane/BoxへCPU Box接触式を適用し、SphereやCapsuleを含むcross-shape接触も同じ`stateMap`へ反映します。Sphereの力積でBox stackが変化したときは、次の反復でBox/BoxとPlane/Boxを再評価します。Compute版はBox、Sphere、CapsuleとPlaneの接触をGPUのcombined solverで同じsolver反復へ処理します。CPUとComputeでは形状計算の実装と演算順序が異なるため、同じ公開入口から接触が連成する処理を確認します。利用者側の入口は、CPU版では`PhysicsSpace`、Compute版では`ComputePhysicsSpace`です。

## 使用しているwebg機能

- `WebgApp`: WebGPU、canvas、depth texture、camera、入力、panel表示を初期化する
- `PhysicsSpace`: CPU版の公開入口としてPhysicsNodeを登録し、fixed stepとcontact eventを管理する
- `ComputePhysicsSpace`: fixed step、GPU BodyState ping-pong、予測AABB、XZ Grid、candidate bitset、combined solver、persistent sleepを管理する
- `CpuMixedPhysicsPipeline`: CPU版のmixed shapeを共有stateMapと同じsolver反復へ接続する
- `ComputeBoxCollider`: Box寸法、逆慣性、CPU版相当の形状queryとBox/Sphere/Plane接触manifoldを提供する
- `ComputeSphereCollider`: Sphere半径、逆慣性、CPU版相当の形状queryとSphere/Box/Plane接触を提供する
- `ComputeCapsuleCollider`: CPU版と同じlocal Y軸Capsuleの半径・芯線長、quaternion姿勢、形状query、Capsule同士／Sphere／Box／Plane接触を提供する
- `ComputePlaneCollider`: 床とXZ四壁を固定Planeとして提供し、CPU版相当のrayと接触APIを提供する
- `Primitive`と`Shape`: GPU stateをinstance描画する単位Box/Sphere/Capsule meshを作る
- `buildHelpPanelOptions()`と`showOverlayPanel()`: 状況表示を折りたたみ可能なpanelとして表示する

## 確認ポイント

- 起動直後に24個ずつのBox、Sphere、Capsuleが表示され、床へ落下すること
- 3形状同士と各形状のPlane接触で通り抜けず、壁の内側に保たれること
- 数秒後に床上のbodyが落ち着き、persistent sleepへ入ったbodyの色が少し青みを帯びること
- panelに平均FPS、平均frame時間、active / sleeping body数、Box / Sphere / Capsule数が表示されること
- `P`でCompute更新だけが止まり、現在のGPU stateの描画は継続すること
- `R`で同じ初期配置へ戻ること
- cameraを動かしても、body位置をCPUへreadbackせず描画できること
- `H`または`Show Panel`で状況表示を開閉できること

## 操作方法

- ドラッグ: camera orbit
- ホイール: zoom
- `P`: pause / resume
- `R`: reset
- `H`: panelの表示 / 非表示

## 実装の流れ

`computePhysicsScenario.js`の`createComputePhysicsScenario()`が、両ページで共有するbody descriptorを生成します。`main.js`はこのdescriptorへ`ComputeBoxCollider`、`ComputeSphereCollider`、または`ComputeCapsuleCollider`を明示的に接続し、同じbody配列として`ComputePhysicsSpace`へ渡します。`cpu_main.js`は同じdescriptorへCPU Colliderと`PhysicsNode`を接続します。形状種別はColliderで明示します。

CPU版の`PhysicsSpace.stepFixed()`は`PhysicsStepPipeline`を通って`CpuMixedPhysicsPipeline`へ進みます。ここで全dynamic bodyのgravity、force、damping、姿勢を一度だけ更新してから、毎回のsolver反復で現在の姿勢から全shape pairを再生成します。Box/BoxとPlane/Boxは`PhysicsContactImpulseSolver`を通じたCPU Box接触式で解き、SphereやCapsuleを含む一般shape pairは同じ`stateMap`へ両bodyの力積と位置補正を反映します。反復の終わりに全bodyを元の`PhysicsNode`へ同期するため、利用者はCPU版でも通常の`PhysicsSpace` APIだけを使えます。

`createBodies()`はこのサンプルのCompute描画対象として`ComputeBoxCollider`、`ComputeSphereCollider`、または`ComputeCapsuleCollider`を生成します。Capsule meshはコアAPIの`Primitive.capsule()`でlocal Y軸の球面半分と円柱から作り、`capsuleVertex`がBodyStateの半径でuniform scaleします。

各frameでは、`physics.encode()`が経過時間をfixed stepへ分けます。各fixed stepは予測AABBを作り、XZ Gridへbodyを登録し、swept Yが重なる候補だけをbody別candidate bitsetへ一度記録します。combined solverはそのbitsetをsolver iteration間で共有し、形状種別に応じた接触計算とPlane接触を処理します。

Render Passでは`ComputePhysicsSpace.getRenderState()`の`bufferIndex`を使って初期化済みbind groupを選びます。Box、Sphere、Capsuleの各pipelineは同じ32 floatのBodyStateを読み、位置、quaternion、shape寸法、色、sleep flagをinstanceごとに適用します。

panel用のbody統計は、12描画frameごとの小さなCompute Passが最新BodyStateのsleep flagと形状種別を数えます。CPUへ戻すのは`active / sleeping / Box / Sphere / Capsule`の5整数だけです。位置や姿勢はreadbackせず、前回の非同期readbackが完了するまで次の集計copyを発行しません。

## CPU版に対応したCompute API

### Colliderのqueryと接触API

`ComputeBoxCollider`、`ComputeSphereCollider`、`ComputeCapsuleCollider`は、GPU用の寸法・逆慣性・WGSLに加えて、CPU版Colliderと同じ形状queryを持ちます。`getWorldInfo(position, quat)`はworld形状を返し、`getAabb()`、`intersectRay()`、`overlapsAabb()`、`overlapSphere()`は明示した位置と姿勢から問い合わせます。`buildContactWith()`と`buildManifoldWith()`はCompute Box、Sphere、Capsule、Planeの組合せを検証して処理し、Boxのface接触では複数contactを保持します。CapsuleはCPU版と同じlocal Y軸をbody quaternionで回転し、BodyStateには`[radius, halfSegment, radius]`を保存します。Broad Phaseでは回転後の芯線両端を半径で広げた軸平行AABBを使います。これらはGPU commandを記録せず、readbackしたBodyStateやGPUを使わないCollider検証から呼び出せます。

`ComputePlaneCollider`も`getWorldInfo()`、`getPlaneDistance()`、`intersectRay()`、`buildContactWith()`、`buildManifoldWith()`を提供します。ただしPlaneの`planeDistance`は`dot(position, normal)`と比較する距離です。CPU版PlaneColliderの位置offsetベクトルとは指定方法が異なります。`ComputePhysicsSpace`のBodyStateにはcollider offset欄がないため、Spaceへ登録するBox、Sphere、Capsuleのoffsetはゼロでなければならず、非ゼロ値は初期化時に例外になります。`offset` optionは受け付けず、`planeDistance`を指定します。Capsuleはlocal Y軸のmeshとcolliderを同じ姿勢で扱い、回転はbodyのquaternionで明示します。

`ComputePhysicsSpace`はbody配列の再登録だけでなく、body IDを使った個別操作にも対応しています。`addBody()`、`removeBody()`、`getBodies()`でbodyを管理し、`setBodyType()`、`setBodyMass()`、`setBodyGravityScale()`、`setBodyMaterial()`、`setBodyAllowSleep()`、`setBodyTrigger()`、`setBodyCollisionLayer()`、`setBodyCollisionMask()`、`setBodyFixedRotation()`で登録後の属性を変更できます。削除後も他のbodyのslotは移動せず、取得したIDとslotの対応は維持されます。

外部からの動作変更には`setBodyLinearVelocity()`、`setBodyAngularVelocity()`、`applyForce()`、`applyTorque()`、`applyImpulse()`、`applyAngularImpulse()`、`teleport()`、`stopBodyMotion()`、`wakeBody()`、`sleepBody()`を使います。これらは次のfixed stepでGPU上の`BodyControl`へ適用され、forceやimpulseはそのstepで一度だけ消費されます。呼出側はcommand encoderへ`encode()`または`encodeFixedStep()`を記録する前に命令を発行します。

Space全体の`gravity`、fixed timestep、最大sub step数、solver反復回数、既定摩擦、既定反発、sleep閾値もsetter/getterで変更できます。CPUへ状態を戻す必要がある場合は、`createStateReadbackBuffer()`、`encodeStateReadback()`、`readStateReadback()`を明示的に使います。通常の描画は`getRenderState()`からGPU bufferを直接参照します。

GPUのBodyStateを`PhysicsNode`へ反映するNode同期も、readback後の明示的な処理として用意しています。`encodeStateReadback()`を`encode()`の後ろへ記録してsubmitし、`readStateReadback()`が返した配列を`syncNodeFromPhysics()`または`syncNodesFromPhysics()`へ渡します。`PhysicsNode`では位置、quaternion、線速度、角速度、sleep状態を同期し、通常の`Node`では位置とquaternionを同期します。通常の`Node`へ速度やsleep状態も反映する場合は、対応メソッドを持つNodeを用意して`syncVelocity: true`、`syncSleep: true`を明示します。反対方向は`syncPhysicsFromNode()`で、Nodeの位置と姿勢、`PhysicsNode`の速度と`bodyType`を次のfixed stepのGPU命令へ変換します。

```js
const readback = physics.createStateReadbackBuffer();
const encoder = device.createCommandEncoder();
physics.encode(encoder, elapsedMs);
physics.encodeStateReadback(encoder, readback);
device.queue.submit([encoder.finish()]);

const stateData = await physics.readStateReadback(readback);
physics.syncNodesFromPhysics(stateData, [{ bodyId, node }], {
  syncVelocity: true,
  syncSleep: true
});
```

この同期処理はGPUからCPUへのcopyと非同期mapを自動では発行しません。GPU上の状態を直接描画する処理フローへreadback待ちを混ぜないため、Node同期が必要なframeだけ呼び出します。

readbackしたBodyStateに対するqueryとして、`raycastFromReadback()`、`raycastAllFromReadback()`、`queryAabbFromReadback()`、`overlapSphereFromReadback()`も用意しています。いずれも第1引数に`readStateReadback()`の結果を要求し、古い初期配置やCPU側の別のshadowを使いません。結果はGPU上のobject参照を作らず、`bodyId`と`slot`、hit位置・法線・距離、またはAABBのmin/maxを返します。`filter` callbackには`getBodyInfo()`相当のbody情報を渡します。`ComputePlaneCollider`の境界Planeはbody IDを持たないため、これらのbody query結果には含めません。

```js
const hit = physics.raycastFromReadback(stateData, [0, 1, -2], [0, 0, 1]);
const bodies = physics.queryAabbFromReadback(
  stateData,
  [-0.5, 0, -0.5],
  [0.5, 1, 0.5],
  { includeTriggers: false }
);
```

body同士の接触も、同じreadback状態から`getContactsFromReadback()`で取得できます。結果は`bodyAId`、`bodyBId`、slot、法線、penetration、接触点を持ちます。Boxのface接触ではColliderが生成した複数contactを保持します。`getManifoldsFromReadback()`はそのmanifold形式を返しますが、readbackへ出ていない接触impulseは復元しません。境界`ComputePlaneCollider`はbody IDを持たないため対象外です。

床や壁などPlaneとの接触は`getPlaneContactsFromReadback()`で別に取得します。結果には`bodyAId`、`bodyASlot`、`planeIndex`、Plane法線、penetration、接触点、支持点数が含まれます。`planeIndex`は`physics.planes`に登録したPlaneの配列indexです。

前回の接触一覧を内部に保存してよい場合は、`getContactEventsFromReadback()`でbegin / stay / endの差分を取得できます。この差分はこのAPIへ渡したreadback世代同士で比較するため、GPUからのcopy、submit、mapは呼出側が明示します。

```js
const contacts = physics.getContactsFromReadback(stateData, { includeTriggers: false });
const planeContacts = physics.getPlaneContactsFromReadback(stateData, { includeTriggers: false });
const manifolds = physics.getManifoldsFromReadback(stateData);
const events = physics.getContactEventsFromReadback(stateData);
```

`getLastContacts()`、`getLastManifolds()`、`getLastContactEvents()`は、最後に明示的なreadbackから生成した結果を返します。`onBeginContact()`、`onStayContact()`、`onEndContact()`のlistenerは、`dispatchContactEventsFromReadback()`を呼んだ時だけ通知されます。contact eventのCPUへの取得と通知は、上記の明示的なreadback操作で行います。

sleep判定を調べる場合は、通常の`BodyState` readbackと`getContactsFromReadback()`、`getPlaneContactsFromReadback()`を明示的に取得し、アプリケーション側で監査値を組み立てます。Compute solverへ診断buffer、診断binding、診断専用分岐は持ち込みません。GPU timestampが必要な計測では、少量のtimestamp queryをphysics passへ明示的に付けられます。

CPU版の`step()`と`stepFixed()`に対応するCompute版入口もあります。`step(commandEncoder, elapsedMs)`と`stepFixed(commandEncoder)`は`encode()`と`encodeFixedStep()`と同じくcommandを記録するだけで、submitは呼出側が行います。Broad Phaseは`getBroadphaseMode()`が返す`xzGrid`に固定され、CPU版の`bruteForce`と`sweepAabb`は選択できません。

## このサンプルの対応範囲

このサンプルの描画と初期配置は動的・固定・kinematicのBox/Sphere/Capsuleと固定Planeを対象とします。反発、摩擦、回転、persistent sleep、trigger、layer / mask、force command、readback状態に対する形状query、body接触、Plane接触を対象とします。Capsuleはlocal Y軸をbody quaternionでworld空間へ回転し、Broad Phaseは回転後の芯線を包む軸平行AABBを使います。接触取得はColliderの複数contactとPlaneごとの代表接触を返しますが、readbackへ出ていないimpulse値、GPU上の現在状態を隠れてCPUへ戻す即時APIは対象外です。未対応機能を別の挙動へ置き換える処理はありません。
