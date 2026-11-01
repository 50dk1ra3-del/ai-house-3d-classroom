// Three.js objects are transient output. The plan remains renderer-independent.
export function buildPlanModel(THREE, layout) {
  if (!layout.valid) throw new Error('検査を通過した配置データが必要です。');
  const group = new THREE.Group(), labels = [];
  group.name = 'json-house';
  const wallMaterial = new THREE.MeshStandardMaterial({ color:layout.style?.outerColor||layout.style?.wallColor||'#eeeadd', roughness:.88 });
  const innerMaterial=new THREE.MeshStandardMaterial({color:layout.style?.innerColor||layout.style?.wallColor||'#eeeadd',roughness:.88,emissive:layout.style?.innerColor||'#DFE2E7',emissiveIntensity:layout.style?.bright?.25:0});
  wallMaterial.emissive?.set(layout.style?.outerColor||'#9499a3');wallMaterial.emissiveIntensity=layout.style?.bright?.18:0;
  const floorMaterial = new THREE.MeshStandardMaterial({ color:'#cdb998', roughness:.92,emissive:'#cdb998',emissiveIntensity:layout.style?.bright?.12:0 });
  const roofMaterial=new THREE.MeshStandardMaterial({color:layout.style?.roofColor||'#c97850',roughness:.85,side:THREE.DoubleSide});
  const coloredWalls=new Map();
  try {
    for (const box of layout.boxes) {
      let colored;if(box.kind==='wall'&&box.wallColor){if(!coloredWalls.has(box.wallColor))coloredWalls.set(box.wallColor,new THREE.MeshStandardMaterial({color:box.wallColor,roughness:.88,emissive:box.wallColor,emissiveIntensity:layout.style?.bright?.22:0}));colored=coloredWalls.get(box.wallColor);}
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), box.kind==='roof'?roofMaterial:box.kind === 'wall' ? (colored||(box.wallType==='inner'?innerMaterial:wallMaterial)) : floorMaterial);
      mesh.position.set(...box.position); mesh.rotation.y = box.rotationY;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { kind:box.kind, sourceId:box.sourceId };
      group.add(mesh);
    }
    for(const surface of layout.surfaces||[]){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(surface.vertices.flat(),3));geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,roofMaterial);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={kind:'roof'};group.add(mesh);}
    for (const label of layout.labels) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.fillStyle='rgba(249,249,241,.92)';ctx.fillRect(0,0,512,128);
      ctx.fillStyle='#34453c';ctx.font='600 42px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(label.text,256,64,480);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));
      sprite.position.set(...label.position);sprite.scale.set(1.7,.425,1);sprite.userData.sourceId=label.id;
      group.add(sprite);labels.push(sprite);
    }
    if(!layout.boxes.some(b=>b.kind==='wall'&&!b.wallColor&&b.wallType!=='inner'))wallMaterial.dispose();
    if(!layout.boxes.some(b=>b.kind==='wall'&&!b.wallColor&&b.wallType==='inner'))innerMaterial.dispose();
    if(!layout.boxes.some(b=>b.kind==='roof')&&!layout.surfaces?.length)roofMaterial.dispose();
    return { group, labels };
  } catch (error) { disposePlanModel(group);coloredWalls.forEach(m=>m.dispose());innerMaterial.dispose();wallMaterial.dispose();floorMaterial.dispose();roofMaterial.dispose();throw error; }
}

export function disposePlanModel(group) {
  const resources = new Set();
  group.traverse(o=>{ if(o.geometry)resources.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){if(m.map)resources.add(m.map);resources.add(m);} });
  resources.forEach(r=>r.dispose());
}
