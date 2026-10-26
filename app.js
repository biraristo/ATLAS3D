const $=id=>document.getElementById(id);const BOLU=[31.6,40.745];let watchId=null,following=false,lastPosition=null,marker=null;
function notify(s,delay=4500){$('notice').textContent=s;$('notice').hidden=false;if(delay)setTimeout(()=>$('notice').hidden=true,delay)}
let token=localStorage.getItem('atlas3d_mapbox_token')||'';
if(!token){token=window.prompt('ATLAS3D: Mapbox public token (pk. ile başlayan) girin:')||'';if(token.startsWith('pk.'))localStorage.setItem('atlas3d_mapbox_token',token)}
if(!token.startsWith('pk.')){notify('Mapbox public token gerekli. Sayfayı yenileyerek token girin.',0);throw Error('Mapbox token missing')}
mapboxgl.accessToken=token;
const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/satellite-streets-v12',center:BOLU,zoom:11.6,pitch:72,bearing:-32,antialias:true});
map.addControl(new mapboxgl.NavigationControl({showCompass:true,visualizePitch:true}),'top-left');
map.on('style.load',()=>{map.addSource('terrain-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});map.setTerrain({source:'terrain-dem',exaggeration:1.25});notify('3D arazi hazır. Haritayı keşfedebilirsiniz.');updateTerrain()});
map.on('error',e=>{console.error('Mapbox:',e.error);notify('Harita yüklenemedi. Token ve internet bağlantısını kontrol edin.',0)});
function updateTerrain(){if(!map.isStyleLoaded())return;const c=following&&lastPosition?lastPosition:[map.getCenter().lng,map.getCenter().lat];const h=map.queryTerrainElevation(c,{exaggerated:false});$('altitude').textContent=Number.isFinite(h)?Math.round(h)+' m':'—';$('coords').textContent=c[1].toFixed(4)+', '+c[0].toFixed(4)}
map.on('moveend',updateTerrain);map.on('idle',updateTerrain);
$('bolu').onclick=()=>{setFollowing(false);$('status').textContent='Bolu Dağı';map.flyTo({center:BOLU,zoom:11.6,pitch:72,bearing:-32,duration:1800})};
$('reset').onclick=()=>map.easeTo({pitch:72,bearing:-32,duration:800});
function setFollowing(v){following=v;$('follow').classList.toggle('active',v);if(v&&lastPosition)map.easeTo({center:lastPosition,zoom:15,pitch:72,duration:1000})}
$('follow').onclick=()=>watchId===null?startLocation(true):setFollowing(!following);
$('locate').onclick=()=>startLocation(true);
function startLocation(follow){if(!navigator.geolocation){notify('Bu cihazda konum servisi bulunamadı.',0);return}if(!window.isSecureContext){notify('GPS için HTTPS gerekli.',0);return}if(watchId!==null){setFollowing(follow);return}setFollowing(follow);$('gps').textContent='GPS aranıyor';watchId=navigator.geolocation.watchPosition(pos=>{const {latitude,longitude,accuracy,heading}=pos.coords;lastPosition=[longitude,latitude];$('gps').textContent='GPS aktif ±'+Math.round(accuracy)+' m';$('status').textContent='Canlı konum';if(!marker)marker=new mapboxgl.Marker({color:'#45b6ff'}).setLngLat(lastPosition).addTo(map);else marker.setLngLat(lastPosition);if(following)map.easeTo({center:lastPosition,zoom:Math.max(map.getZoom(),14.5),pitch:72,...(Number.isFinite(heading)?{bearing:heading}:{}),duration:700});updateTerrain()},err=>{$('gps').textContent='GPS kullanılamıyor';notify('Konum alınamadı: '+err.message,0);watchId=null;setFollowing(false)},{enableHighAccuracy:true,maximumAge:2000,timeout:15000})}