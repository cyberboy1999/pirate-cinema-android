import {useEffect} from "react";

const selector="button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
const textFieldSelector="textarea,input:not([type]),input[type='text'],input[type='search'],input[type='url'],input[type='email'],input[type='password'],input[type='tel'],input[type='number']";

function textField(element:Element|null):element is HTMLInputElement|HTMLTextAreaElement{return Boolean(element?.matches(textFieldSelector))}

function focusable(){
  const nodes=[...document.querySelectorAll<HTMLElement>("main *")],surfaces=nodes.flatMap((element,index)=>{const style=getComputedStyle(element),z=Number(style.zIndex),backdrop=element.matches("button[aria-label^='Закрыть'],button[aria-label^='Close']"),layer=(style.position==="absolute"||style.position==="fixed")&&z>=10;if(!backdrop&&!layer)return [];const container=backdrop?element.parentElement:element,root=backdrop?container?.querySelector<HTMLElement>("section")??container:container;return root?.querySelector(selector)?[{root,z:backdrop?Number(getComputedStyle(container!).zIndex):z,index}]:[]}).sort((left,right)=>right.z-left.z||right.index-left.index);
  const root=surfaces[0]?.root??document;
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(element=>{
    const box=element.getBoundingClientRect(),style=getComputedStyle(element);
    return box.width>0&&box.height>0&&style.visibility!=="hidden"&&style.display!=="none";
  });
}

export function useTvFocus(enabled:boolean,scope:string){
  useEffect(()=>{
    if(!enabled)return;
    const originalReadonly=new Map<HTMLInputElement|HTMLTextAreaElement,boolean>();
    const lock=(element:Element|null)=>{if(!textField(element))return;originalReadonly.set(element,originalReadonly.get(element)??element.readOnly);element.readOnly=true;delete element.dataset.tvEditing};
    const unlock=(element:Element|null)=>{if(!textField(element)||originalReadonly.get(element))return;element.readOnly=false;element.dataset.tvEditing="true";element.focus({preventScroll:true});element.click()};
    document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>(textFieldSelector).forEach(lock);
    const initial=requestAnimationFrame(()=>{
      const elements=focusable(),player=scope.includes("player")?document.querySelector<HTMLElement>("[aria-label='Системный плеер']"):null,current=document.querySelector<HTMLElement>("nav button[aria-current='page']");
      const target=player&&elements.includes(player)?player:current&&elements.includes(current)?current:elements.find(element=>!textField(element))??elements[0];lock(target);target?.focus({preventScroll:true});
    });
    const move=(event:KeyboardEvent)=>{
      if(event.defaultPrevented)return;
      const active=document.activeElement as HTMLElement|null;
      if((event.key==="Enter"||event.key==="NumpadEnter")&&textField(active)&&active.readOnly){event.preventDefault();unlock(active);return}
      const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key] as [number,number]|undefined;
      if(!direction||event.altKey||event.ctrlKey||event.metaKey)return;
      if(active?.matches("select"))return;
      lock(active);
      const elements=focusable();
      if(!elements.length)return;
      if(!active||!elements.includes(active)){const first=elements.find(element=>!textField(element))??elements[0];lock(first);first.focus();event.preventDefault();return;}
      const current=document.querySelector<HTMLElement>("nav button[aria-current='page']");
      if(direction[0]<0&&!active.closest("nav")&&current&&elements.includes(current)){event.preventDefault();current.focus();current.scrollIntoView({block:"nearest",inline:"nearest"});return}
      const from=active.getBoundingClientRect(),x=from.left+from.width/2,y=from.top+from.height/2;
      const inNav=Boolean(active.closest("nav"));
      const candidates=elements.filter(element=>direction[0]&&inNav?!element.closest("nav"):inNav?Boolean(element.closest("nav")):!element.closest("nav"));
      const minimum=direction[0]?2:Math.max(2,Math.min(from.height,80)*.5);
      const next=candidates.map(element=>{const box=element.getBoundingClientRect(),dx=box.left+box.width/2-x,dy=box.top+box.height/2-y,main=direction[0]?dx*direction[0]:dy*direction[1],cross=direction[0]?Math.abs(dy):Math.abs(dx);return {element,main,score:main+cross*(direction[0]?.75:.35)}}).filter(item=>item.main>minimum).sort((a,b)=>a.score-b.score)[0]?.element;
      event.preventDefault();
      if(next){lock(next);next.focus();next.scrollIntoView({block:"nearest",inline:"nearest"})}
    };
    const refocus=(event:FocusEvent)=>lock(event.target as Element);
    const pointer=(event:PointerEvent)=>lock(event.target as Element);
    window.addEventListener("keydown",move);
    document.addEventListener("focusin",refocus);
    document.addEventListener("pointerdown",pointer,true);
    return()=>{cancelAnimationFrame(initial);window.removeEventListener("keydown",move);document.removeEventListener("focusin",refocus);document.removeEventListener("pointerdown",pointer,true);originalReadonly.forEach((readonly,element)=>{element.readOnly=readonly;delete element.dataset.tvEditing})};
  },[enabled,scope]);
}
