import pathlib,json,zlib,struct,hashlib
O=pathlib.Path(__file__).parent;G=O.parent/'game_import_20261021';S=pathlib.Path('D:/Unity/Valhalla/Sculpture/works/sirius-tidegrave-01m/design/rudder_bearing_20261021/after_bearing.vxk')
def dec(p):
 raw=zlib.decompress(p.read_bytes(),-15);n=struct.unpack_from('<I',raw,4)[0];return json.loads(raw[8:8+n]),raw[8+n:]
b,bb=dec(S);a,ab=dec(G/'VoxelKit/_cache/tidegrave.vxk');assert bb==ab,'body changed'
assert a['rig']['models']==b['rig']['models'];assert a['rig']['meshes']==b['rig']['meshes'];assert a['rig']['sails']==b['rig']['sails']
ropeextras=[]
for x,y in zip(a['rig']['ropes'],b['rig']['ropes']):
 q=dict(x);q.pop('bind',None);r=dict(y);r.pop('bind',None);assert q==r
 if x.get('bind')!=y.get('bind'):ropeextras.append(x.get('name'))
assert len(a['rig']['ropes'])==len(b['rig']['ropes'])==502
assert len(a['rig']['models'])==241 and len(a['rig']['sails'])==10
report={'source_candidate_sha256':hashlib.sha256(S.read_bytes()).hexdigest(),'game_cache_sha256':hashlib.sha256((G/'VoxelKit/_cache/tidegrave.vxk').read_bytes()).hexdigest(),'static_body_bytes_equal':True,'models_meshes_sails_equal':True,'ropes_equal_except_generated_bind':True,'generated_rope_bind_differences':len(ropeextras),'voxels':a['voxels'],'models':241,'ropes':502,'sails':10,'header_changed_keys':[k for k in a.keys()|b.keys() if a.get(k)!=b.get(k)]}
(O/'import_compare.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
