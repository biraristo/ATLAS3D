const $=id=>document.getElementById(id);const BOLU=[31.6,40.745];let watchId=null,following=false,lastPosition=null,marker=null;
function notify(s,delay=4500){$('notice').textContent=s;$('notice').hidden=false;if(delay)setTimeout(()=>$('notice').hidden=true,delay)}
let token=localStorage.getItem('atlas3d_mapbox_token')||'';
if(!token){token=window.prompt('ATLAS3D: Mapbox public token (pk. ile başlayan) girin:')||'';if(token.startsWith('pk.'))localStorage.setItem('atlas3d_mapbox_token',token)}
if(!token.startsWith('pk.')){notify('Mapbox public token gerekli. Sayfayı yenileyerek token girin.',0);throw Error('Mapbox token missing')}
mapboxgl.accessToken=token;
const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/outdoors-v12',center:BOLU,zoom:11.6,pitch:72,bearing:-32,antialias:true});
map.addControl(new mapboxgl.NavigationControl({showCompass:true,visualizePitch:true}),'top-left');
map.on('style.load',()=>{map.addSource('terrain-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});map.setTerrain({source:'terrain-dem',exaggeration:1.25});notify('3D arazi hazır. Uydu görüntüsü için sağ üstteki Uydu düğmesini kullanın.');updateTerrain()});
map.on('error',e=>{console.error('Mapbox:',e.error);const msg=String(e.error?.message||'');if(/429|Too Many Requests/i.test(msg))notify('Mapbox 429: Görüntü istekleri sınırlandırıldı. Bir süre sonra yeniden deneyin.',6500);else notify('Harita kaynağı hatası: '+msg.slice(0,100),6500)});
function updateTerrain(){if(!map.isStyleLoaded())return;const c=following&&lastPosition?lastPosition:[map.getCenter().lng,map.getCenter().lat];const h=map.queryTerrainElevation(c,{exaggerated:false});$('altitude').textContent=Number.isFinite(h)?Math.round(h)+' m':'—';$('coords').textContent=c[1].toFixed(4)+', '+c[0].toFixed(4)}
map.on('moveend',updateTerrain);map.on('idle',updateTerrain);
$('bolu').onclick=()=>{setFollowing(false);$('status').textContent='Bolu Dağı';map.flyTo({center:BOLU,zoom:11.6,pitch:72,bearing:-32,duration:1800})};
$('reset').onclick=()=>map.easeTo({pitch:72,bearing:-32,duration:800});
function setFollowing(v){following=v;$('follow').classList.toggle('active',v);if(v&&lastPosition)map.easeTo({center:lastPosition,zoom:15,pitch:72,duration:1000})}
$('follow').onclick=()=>watchId===null?startLocation(true):setFollowing(!following);
$('locate').onclick=()=>startLocation(true);
function startLocation(follow){if(!navigator.geolocation){notify('Bu cihazda konum servisi bulunamadı.',0);return}if(!window.isSecureContext){notify('GPS için HTTPS gerekli.',0);return}if(watchId!==null){setFollowing(follow);return}setFollowing(follow);$('gps').textContent='GPS aranıyor';watchId=navigator.geolocation.watchPosition(pos=>{const {latitude,longitude,accuracy,heading}=pos.coords;lastPosition=[longitude,latitude];$('gps').textContent='GPS aktif ±'+Math.round(accuracy)+' m';$('status').textContent='Canlı konum';if(!marker)marker=new mapboxgl.Marker({color:'#45b6ff'}).setLngLat(lastPosition).addTo(map);else marker.setLngLat(lastPosition);if(following)map.easeTo({center:lastPosition,zoom:Math.max(map.getZoom(),14.5),pitch:72,...(Number.isFinite(heading)?{bearing:heading}:{}),duration:700});updateTerrain()},err=>{$('gps').textContent='GPS kullanılamıyor';notify('Konum alınamadı: '+err.message,0);watchId=null;setFollowing(false)},{enableHighAccuracy:true,maximumAge:2000,timeout:15000})}

const providers={
  topo:{label:'Topoğrafik'},
  esri:{label:'Esri Uydu',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],attribution:'Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'},
  mapbox:{label:'Mapbox Uydu',url:'mapbox://mapbox.satellite',tileSize:256},
  maptiler:{label:'MapTiler Uydu',url:()=> 'https://api.maptiler.com/tiles/satellite/tiles.json?key='+encodeURIComponent(getProviderKey('maptiler'))}
};
let sharedMaptilerKey='',sharedGoogleKey='';
async function loadSharedConfig(){try{const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();sharedMaptilerKey=data.maptilerKey||'';sharedGoogleKey=data.googleTilesKey||''}catch(e){console.warn('Shared configuration unavailable:',e)}}
const configReady=loadSharedConfig();
function getProviderKey(name){return name==='maptiler'?sharedMaptilerKey:(localStorage.getItem('atlas3d_'+name+'_key')||'')}
function askProviderKey(name,label){let key=getProviderKey(name);if(!key){key=prompt(label+' API anahtarını girin (tarayıcıda saklanır):')?.trim()||'';if(key)localStorage.setItem('atlas3d_'+name+'_key',key)}return key}
const select=document.createElement('select');select.id='imagery-provider';select.setAttribute('aria-label','Harita görüntü sağlayıcısı');select.style.cssText='width:110px;background:#14283b;color:white;border:1px solid #ffffff66;border-radius:12px;padding:10px 5px;font-size:12px;cursor:pointer';
for(const [id,p] of Object.entries(providers)){const o=document.createElement('option');o.value=id;o.textContent=p.label;select.appendChild(o)}
const googleOption=document.createElement('option');googleOption.value='google';googleOption.textContent='Google 3D';select.appendChild(googleOption);
const control=document.querySelector('.controls');control.prepend(select);
const oldButton=control.querySelector('button');if(oldButton&&oldButton.textContent==='Uydu')oldButton.remove();
let activeProvider='topo';
function clearImagery(){if(map.getLayer('atlas-imagery-layer'))map.removeLayer('atlas-imagery-layer');if(map.getSource('atlas-imagery'))map.removeSource('atlas-imagery')}
let googleViewer=null,googleTileset=null;
async function enableGoogle3D(){await configReady;if(!sharedGoogleKey){await loadSharedConfig()}if(!sharedGoogleKey){notify('Google 3D anahtarı çalışan Cloudflare Worker yapılandırmasında bulunamadı. ATLAS3D → Settings → Variables and Secrets bölümünde GOOGLE_MAPS_API_KEY değişkeninin Production ortamında olduğunu ve son dağıtımın tamamlandığını kontrol edin.',12000);select.value=activeProvider;return}
if(!window.Cesium){notify('CesiumJS yüklenemedi. İnternet bağlantısını kontrol edin.',9000);select.value=activeProvider;return}
const container=$('google-3d');container.hidden=false;document.body.classList.add('google-mode');
try{if(!googleViewer){googleViewer=new Cesium.Viewer(container,{globe:false,baseLayer:false,animation:false,timeline:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,infoBox:false,selectionIndicator:false,fullscreenButton:false,baseLayerPicker:false});googleViewer.scene.globe.show=false;googleViewer.scene.skyAtmosphere.show=false;googleTileset=await Cesium.createGooglePhotorealistic3DTileset(sharedGoogleKey);googleViewer.scene.primitives.add(googleTileset)}
const c=map.getCenter();googleViewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(c.lng,c.lat,4200),orientation:{heading:Cesium.Math.toRadians(map.getBearing()),pitch:Cesium.Math.toRadians(-45),roll:0},duration:1.5});select.value='google';notify('Google Photorealistic 3D açıldı.',4500)}catch(e){console.error('Google 3D:',e);container.hidden=true;document.body.classList.remove('google-mode');notify('Google 3D yüklenemedi: '+String(e.message||e).slice(0,130),9000);select.value=activeProvider}}
function setImagery(id){if(id==='google'){enableGoogle3D();return}
$('google-3d').hidden=true;document.body.classList.remove('google-mode');

const p=providers[id];if(!p)return;
if(id==='maptiler'&&!sharedMaptilerKey){notify('MapTiler yapılandırması yüklenemedi. Cloudflare Worker dağıtımını kontrol edin.',8000);select.value=activeProvider;return}
clearImagery();
if(id!=='topo'){const src={type:'raster',tileSize:p.tileSize||256};if(p.tiles)src.tiles=p.tiles;if(p.url)src.url=typeof p.url==='function'?p.url():p.url;if(p.attribution)src.attribution=p.attribution;map.addSource('atlas-imagery',src);const first=map.getStyle().layers.find(l=>l.type==='symbol');map.addLayer({id:'atlas-imagery-layer',type:'raster',source:'atlas-imagery',paint:{'raster-opacity':1}},first?.id)}
activeProvider=id;select.value=id;notify(id==='topo'?'Topoğrafik harita etkin.':p.label+' görüntüsü yükleniyor…',4500)}
select.onchange=async()=>{await configReady;try{setImagery(select.value)}catch(e){console.error(e);notify('Katman eklenemedi: '+e.message,8000);select.value=activeProvider}};
