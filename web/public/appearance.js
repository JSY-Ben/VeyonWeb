export const defaultAppearance={app_name:'VeyonWeb',primary_colour:'#215c48',theme:'light',app_logo:'',login_graphic:''};
export function colourTokens(hex){
  if(!/^#[\da-f]{6}$/i.test(hex))hex=defaultAppearance.primary_colour;
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const luminance=rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const mix=(to,amount)=>'#'+rgb.map(c=>Math.round(c*(1-amount)+to*amount).toString(16).padStart(2,'0')).join('');
  return {primary:hex,onPrimary:luminance>.179?'#000000':'#ffffff',sidebar:mix(0,.72),hover:mix(luminance>.179?255:0,.14),focusLight:luminance>.18?mix(0,.55):hex,focusDark:luminance<.3?mix(255,.55):hex};
}
let current={...defaultAppearance};
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){document.documentElement.dataset.theme=current.theme==='system'?(systemTheme.matches?'dark':'light'):current.theme;}
systemTheme.addEventListener('change',applyTheme);
export function applyAppearance(values){
  current={...defaultAppearance,...values};
  const root=document.documentElement,tokens=colourTokens(current.primary_colour);
  for(const [name,value] of Object.entries(tokens))root.style.setProperty('--'+name,value);
  root.style.setProperty('--green',tokens.primary);root.style.setProperty('--sidebar',tokens.sidebar);
  applyTheme();document.title=current.app_name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',tokens.sidebar);
  document.querySelectorAll('.brand').forEach(brand=>{
    brand.setAttribute('aria-label',current.app_name+' home');
    const mark=brand.querySelector('.brand-icon');mark.replaceChildren();
    if(current.app_logo){const image=document.createElement('img');image.src=current.app_logo;image.alt='';mark.append(image);}
    else mark.textContent=current.app_name.trim().charAt(0).toUpperCase();
    brand.querySelector('.brand-name').textContent=current.app_name;
  });
  const graphic=document.querySelector('#login-graphic'),fallback=document.querySelector('.story-grid');
  graphic.hidden=!current.login_graphic;fallback.hidden=!!current.login_graphic;
  if(current.login_graphic)graphic.src=current.login_graphic;else graphic.removeAttribute('src');
}
