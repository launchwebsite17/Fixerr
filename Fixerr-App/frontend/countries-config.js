/* ============================================================================
   countries-config.js — shared countries_config helpers
   Loaded before nav.js (public pages) and before the inline FX block on
   dashboards / payment-checkout. Labels, symbols, phone/postal rules, and
   number formatting all come from GET /api/countries_config (with a 2-row
   IN/US fallback if the API is down).
   ============================================================================ */
const FX_COUNTRIES_FALLBACK=[
  {country_code:"IN",country_name:"India",flag_emoji:"🇮🇳",currency_code:"INR",currency_symbol:"₹",currency_decimals:0,number_locale:"en-IN",tax_label:"GST",postal_code_label:"PIN Code",postal_code_regex:"^[1-9][0-9]{5}$",postal_code_example:"600001",phone_dial_code:"+91",phone_regex:"^[6-9][0-9]{9}$",phone_example:"+91 98765 43210",distance_unit:"km",date_format:"DD/MM/YYYY",is_default:true,sort_order:1},
  {country_code:"US",country_name:"United States",flag_emoji:"🇺🇸",currency_code:"USD",currency_symbol:"$",currency_decimals:0,number_locale:"en-US",tax_label:"Sales Tax",postal_code_label:"ZIP Code",postal_code_regex:"^[0-9]{5}(-[0-9]{4})?$",postal_code_example:"10001",phone_dial_code:"+1",phone_regex:"^[2-9][0-9]{9}$",phone_example:"+1 (555) 000-0000",distance_unit:"mi",date_format:"MM/DD/YYYY",is_default:false,sort_order:2}
];
let FX_COUNTRIES=FX_COUNTRIES_FALLBACK.slice();

function fxCountryCfg(cc){
  return FX_COUNTRIES.find(c=>c.country_code===cc)||null;
}
function fxCfgByCurrency(cur){
  return FX_COUNTRIES.find(c=>c.currency_code===cur)||null;
}
function fxDefaultCountry(){
  const row=FX_COUNTRIES.find(c=>c.is_default)||FX_COUNTRIES[0];
  return row?row.country_code:"IN";
}
function fxApplyCountryCfg(cc){
  const cfg=fxCountryCfg(cc);
  if(!cfg||typeof FX==="undefined") return cfg;
  FX.country=cfg.country_code;
  FX.currency=cfg.currency_code;
  FX.symbol=cfg.currency_symbol;
  FX.flag=cfg.flag_emoji;
  return cfg;
}
function fxPostalShort(cc){
  const cfg=fxCountryCfg(cc);
  if(cfg&&cfg.postal_code_label) return cfg.postal_code_label.replace(/\s*Code$/i,"");
  return cc==="IN"?"PIN":"ZIP";
}
function fxPostalMaxLen(cc){
  const cfg=fxCountryCfg(cc);
  if(!cfg) return 10;
  if((cfg.postal_code_regex||"").indexOf("-")>=0) return 10;
  return (cfg.postal_code_example||"").length||10;
}
function fxDistanceWord(cc){
  const u=(fxCountryCfg(cc)||{}).distance_unit;
  return u==="mi"?"miles":"km";
}
function fxCountryName(cc){
  const cfg=fxCountryCfg(cc);
  return cfg?cfg.country_name:(cc||"—");
}
function fxCurrencyLabel(ccOrCur){
  const cfg=fxCountryCfg(ccOrCur)||fxCfgByCurrency(ccOrCur);
  if(!cfg) return ccOrCur||"";
  return cfg.currency_symbol+" "+cfg.currency_code;
}
function fxNumberLocale(ccOrCur){
  const cfg=fxCountryCfg(ccOrCur)||fxCfgByCurrency(ccOrCur);
  return (cfg&&cfg.number_locale)||"en-US";
}
function fxFmtAmount(v, ccOrCur){
  const cfg=fxCountryCfg(ccOrCur)||fxCfgByCurrency(ccOrCur);
  const sym=(cfg&&cfg.currency_symbol)||"";
  const loc=(cfg&&cfg.number_locale)||"en-US";
  const dec=cfg&&cfg.currency_decimals!=null?Number(cfg.currency_decimals):0;
  const n=Number(v)||0;
  if(dec===0) return sym+Math.round(n).toLocaleString(loc);
  return sym+n.toLocaleString(loc,{minimumFractionDigits:dec,maximumFractionDigits:dec});
}
function fxNormalizePhone(raw, cc){
  let d=String(raw||"").replace(/\D/g,"");
  const dial=((fxCountryCfg(cc)||{}).phone_dial_code||"").replace(/\D/g,"");
  if(dial&&d.startsWith(dial)) d=d.slice(dial.length);
  return d;
}
function fxPhoneValid(raw, cc){
  const cfg=fxCountryCfg(cc);
  if(!cfg||!cfg.phone_regex) return true;
  try{ return new RegExp(cfg.phone_regex).test(fxNormalizePhone(raw, cc)); }
  catch(e){ return true; }
}
function fxPostalValid(raw, cc){
  const cfg=fxCountryCfg(cc);
  if(!cfg||!cfg.postal_code_regex) return true;
  try{ return new RegExp(cfg.postal_code_regex).test(String(raw||"").trim()); }
  catch(e){ return true; }
}
function fxPhoneErr(ph, cc){
  if(!ph) return "Phone number is required";
  if(fxPhoneValid(ph, cc)) return null;
  const ex=(fxCountryCfg(cc)||{}).phone_example||"";
  return "Enter a valid phone number"+(ex?" (e.g. "+ex+")":"");
}
function fxPostalErr(zip, cc, required){
  const v=String(zip||"").trim();
  const label=(fxCountryCfg(cc)||{}).postal_code_label||"postal code";
  const ex=(fxCountryCfg(cc)||{}).postal_code_example||"";
  if(!v) return required?"Please enter a valid "+label:null;
  if(fxPostalValid(v, cc)) return null;
  return "Please enter a valid "+label+(ex?" (e.g. "+ex+")":"");
}
function fxPaintCountryFields(scope){
  const root=scope||document;
  if(typeof FX==="undefined") return;
  const cfg=fxCountryCfg(FX.country);
  const phEx=(cfg&&cfg.phone_example)||"";
  const zipLbl=(cfg&&cfg.postal_code_label)||"Postal code";
  const zipEx=(cfg&&cfg.postal_code_example)||"";
  root.querySelectorAll("[data-ph]").forEach(el=>{
    el.placeholder=phEx;
    if(el.getAttribute("aria-label")) el.setAttribute("aria-label", phEx);
  });
  root.querySelectorAll("[data-zip-lbl]").forEach(el=>{
    const opt=el.hasAttribute("data-zip-optional")||/optional/i.test(el.textContent||"");
    el.textContent=zipLbl+(opt?" (optional)":"");
  });
  root.querySelectorAll("[data-zip-inp]").forEach(el=>{ el.placeholder=zipEx; });
  const navzip=root.getElementById?root.getElementById("nav-zip"):document.getElementById("nav-zip");
  if(navzip){
    navzip.style.display=FX.city?"inline-block":"none";
    navzip.placeholder=fxPostalShort(FX.country);
    navzip.maxLength=fxPostalMaxLen(FX.country);
  }
}
async function loadCountriesConfig(){
  const cached=sessionStorage.getItem("fx_countries_config");
  if(cached){
    try{
      const rows=JSON.parse(cached);
      if(Array.isArray(rows)&&rows.length){ FX_COUNTRIES=rows; return; }
    }catch(e){}
  }
  try{
    const base=(location.hostname==="localhost"||location.hostname==="127.0.0.1")?"http://localhost:3001":location.origin;
    const r=await fetch(base+"/api/countries_config",{headers:{"Content-Type":"application/json"}});
    const rows=await r.json();
    if(Array.isArray(rows)&&rows.length){
      FX_COUNTRIES=rows;
      sessionStorage.setItem("fx_countries_config",JSON.stringify(rows));
    }
  }catch(e){}
}
