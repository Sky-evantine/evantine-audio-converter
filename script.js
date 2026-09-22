const SHOPIFY_STORE="https://1bmwgi-pw.myshopify.com";
const COLLECTION_IMAGES={
  "001":"https://cdn.shopify.com/s/files/1/0810/8507/1396/collections/evantine-collection-001-editorial.png?v=1789917110",
  "002":"https://cdn.shopify.com/s/files/1/0810/8507/1396/collections/evantine-collection-002.png?v=1789917116",
  "003":"https://cdn.shopify.com/s/files/1/0810/8507/1396/collections/evantine-collection-003.png?v=1789917122"
};
const LOCAL_PRODUCTS=[
{name:"EVANTINE TEE 001",meta:"Heavyweight cotton · $48",price:48,no:"01",type:"apparel",slug:"evantine-tee-001",description:"A substantial everyday tee designed as the starting point for Collection 001.",tilt:"7deg",image:COLLECTION_IMAGES["001"]},
{name:"STUDIO HOODIE 001",meta:"Brushed fleece · $96",price:96,no:"02",type:"apparel",slug:"studio-hoodie-001",description:"A soft, structured layer for cold walks, late nights, and everywhere between.",tilt:"-8deg",image:COLLECTION_IMAGES["001"]},
{name:"EVERYDAY CAP 001",meta:"Cotton twill · $38",price:38,no:"03",type:"objects",slug:"everyday-cap-001",description:"An understated everyday cap with an easy silhouette and studio attitude.",tilt:"12deg",image:COLLECTION_IMAGES["001"]},
{name:"EVANTINE TOTE 001",meta:"Heavy canvas · $42",price:42,no:"04",type:"objects",slug:"evantine-tote-001",description:"A durable carry-all for the things that follow you through the day.",tilt:"-6deg",image:COLLECTION_IMAGES["001"]}];
let products=[...LOCAL_PRODUCTS];
const $=s=>document.querySelector(s),grid=$("#productGrid"),resultCount=$("#resultCount"),bagCount=$("#bagCount"),toast=$("#toast"),menu=$(".menu-toggle"),nav=$("#site-nav"),bagPanel=$("#bagPanel"),bagItems=$("#bagItems"),bagTotal=$("#bagTotal"),bagButton=$(".bag-button"),bagClose=$("#bagClose"),overlay=$("#overlay"),modal=$("#productModal"),modalClose=$("#modalClose"),modalAdd=$("#modalAdd");
let bag=[];try{bag=JSON.parse(localStorage.getItem("evantineBag")||"[]");if(!Array.isArray(bag))bag=[];}catch{bag=[]}
let selected=null;
const money=n=>"$"+Number(n||0).toFixed(2).replace(".00","");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]||c));
function collectionNo(p){const match=((p.tags||[]).join(" ")+" "+(p.title||"")+" "+(p.body_html||"")).match(/(?:Collection\s*)?(001|002|003)/i);return match?match[1]:"001";}
function typeFor(p){return /cap|tote|bag|object|accessor|poster|tag|scarf|beanie/i.test((p.product_type||"")+" "+(p.title||""))?"objects":"apparel";}
function renderProducts(filter="all"){
  if(!grid)return;
  const visible=products.filter(p=>filter==="all"||p.type===filter);
  if(resultCount){resultCount.textContent=visible.length+" piece"+(visible.length===1?"":"s");resultCount.setAttribute("aria-label",visible.length+" pieces shown");}
  grid.innerHTML=visible.map(p=>{
    const image=p.image||COLLECTION_IMAGES[collectionNo(p)]||COLLECTION_IMAGES["001"];
    return '<article class="product-card" data-id="'+esc(p.no)+'"><a class="product-link" href="product.html?handle='+encodeURIComponent(p.slug||"")+'" aria-label="View '+esc(p.name)+'"><span class="product-image product-'+esc(p.no)+'">'+
      '<span class="product-no">'+esc(p.no)+'</span><span class="product-type">'+esc(p.type)+'</span><span class="product-index">EV / '+esc(collectionNo(p))+'</span>'+
      '<img class="product-photo" src="'+esc(image)+'" alt="'+esc(p.name)+' design preview" loading="lazy"><span class="product-view">View piece ↗</span></span>'+
      '<span class="product-name">'+esc(p.name)+'</span><span class="product-meta">'+esc(p.meta)+'</span></a>'+
      '<button class="card-add" type="button" data-add="'+esc(p.no)+'" aria-label="Add '+esc(p.name)+' to bag">Add to bag</button></article>';
  }).join("");
}
function updateBag(){
  if(!bagCount||!bagItems||!bagTotal)return;
  bagCount.textContent=bag.reduce((sum,item)=>sum+item.qty,0);
  const total=bag.reduce((sum,item)=>sum+item.price*item.qty,0);bagTotal.textContent=money(total);
  bagItems.innerHTML=bag.length?bag.map(item=>{
    const image=item.image||COLLECTION_IMAGES[collectionNo(item)]||COLLECTION_IMAGES["001"];
    return '<div class="bag-item"><span class="bag-thumb"><img src="'+esc(image)+'" alt="" loading="lazy"></span><div><h3>'+esc(item.name)+'</h3><p>'+item.qty+" × "+money(item.price)+'</p></div><button class="remove-item" type="button" data-remove="'+esc(item.no)+'" aria-label="Remove '+esc(item.name)+' from bag">Remove</button></div>';
  }).join(""):'<p class="empty-bag">Your bag is empty. Start with Collections.</p>';
  localStorage.setItem("evantineBag",JSON.stringify(bag));
}
function showToast(message){if(!toast)return;toast.textContent=message;toast.classList.add("show");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>toast.classList.remove("show"),2200);}
function closeOverlays(){if(bagPanel){bagPanel.classList.remove("open");bagPanel.setAttribute("aria-hidden","true");}if(bagButton)bagButton.setAttribute("aria-expanded","false");if(modal)modal.hidden=true;if(overlay)overlay.hidden=true;document.body.style.overflow="";if(bagButton)bagButton.focus();}
function openBag(){if(!bagPanel||!overlay)return;bagPanel.classList.add("open");bagPanel.setAttribute("aria-hidden","false");if(bagButton)bagButton.setAttribute("aria-expanded","true");overlay.hidden=false;document.body.style.overflow="hidden";if(bagClose)bagClose.focus();}
function addToBag(product){const existing=bag.find(item=>item.no===product.no&&item.shopifyId===product.shopifyId);if(existing)existing.qty++;else bag.push({...product,qty:1});updateBag();showToast(product.name+" added to bag");}
async function loadShopifyProducts(){
  try{
    const response=await fetch(SHOPIFY_STORE+"/products.json?limit=250",{headers:{Accept:"application/json"}});
    if(!response.ok)throw new Error("Shopify products unavailable");
    const data=await response.json();
    if(Array.isArray(data.products)&&data.products.length){
      products=data.products.map((p,i)=>{
        const v=p.variants?.[0]||{}, collection=collectionNo(p), image=p.images?.[0]?.src||COLLECTION_IMAGES[collection]||COLLECTION_IMAGES["001"];
        return {name:p.title,meta:(p.product_type||"Apparel")+" · "+money(v.price),price:Number(v.price||0),no:String(i+1).padStart(2,"0"),type:typeFor(p),slug:p.handle,description:(p.body_html||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()||"Evantine Apparel piece.",tilt:"0deg",shopifyId:p.id,variantId:v.id,image,tags:p.tags||[],collectionName:"Collection "+collection,collection:"0"+collection+" / 2026"};
      });
    }
  }catch(error){console.warn("Shopify integration fallback:",error);}
  renderProducts();updateBag();window.dispatchEvent(new CustomEvent("evantine:products-ready"));
}
window.evProductReady=loadShopifyProducts();
function setActiveNav(){const path=location.pathname.split("/").pop()||"index.html";document.querySelectorAll(".site-nav a").forEach(a=>{const href=a.getAttribute("href")||"",target=href.split("#")[0].split("/").pop();if(target===path)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});}
setActiveNav();
document.querySelectorAll(".filter").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(b=>{b.classList.remove("active");b.setAttribute("aria-pressed","false")});button.classList.add("active");button.setAttribute("aria-pressed","true");renderProducts(button.dataset.filter);}));
if(grid)grid.addEventListener("click",e=>{const add=e.target.closest("[data-add]");if(add){e.preventDefault();const product=products.find(p=>p.no===add.dataset.add);if(product)addToBag(product);}});
if(modalAdd)modalAdd.addEventListener("click",()=>{if(selected){addToBag(selected);closeOverlays();}});
if(bagItems)bagItems.addEventListener("click",e=>{const remove=e.target.closest("[data-remove]");if(!remove)return;bag=bag.filter(item=>item.no!==remove.dataset.remove);updateBag();});
document.querySelectorAll(".checkout-button").forEach(button=>button.addEventListener("click",()=>{if(!bag.length){showToast("Your bag is empty");return;}const lines=bag.filter(item=>item.variantId).map(item=>item.variantId+":"+item.qty);if(lines.length){location.href=SHOPIFY_STORE+"/cart/"+lines.join(",");return;}location.href=SHOPIFY_STORE+"/collections/all";}));
if(bagButton)bagButton.addEventListener("click",openBag);if(bagClose)bagClose.addEventListener("click",closeOverlays);if(modalClose)modalClose.addEventListener("click",closeOverlays);if(overlay)overlay.addEventListener("click",closeOverlays);
if(menu)menu.addEventListener("click",()=>{const open=menu.getAttribute("aria-expanded")==="true";menu.setAttribute("aria-expanded",String(!open));if(nav)nav.classList.toggle("open",!open);});
if(nav)nav.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{if(menu)menu.setAttribute("aria-expanded","false");nav.classList.remove("open");}));
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeOverlays();});
