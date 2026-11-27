(() => {
 "use strict";
 const css=".lbis-password-control{position:relative;display:flex;align-items:stretch;width:100%}.lbis-password-control input{flex:1;min-width:0;padding-right:3.25rem}.lbis-password-toggle{position:absolute;right:.35rem;top:50%;transform:translateY(-50%);border:0;background:transparent;color:inherit;cursor:pointer;padding:.45rem .6rem;border-radius:.35rem;font:inherit;line-height:1}.lbis-password-toggle:focus-visible{outline:2px solid currentColor;outline-offset:2px}";
 const style=document.createElement("style");style.textContent=css;document.head.appendChild(style);
 document.querySelectorAll('input[type="password"]').forEach(input=>{
  if(input.dataset.lbisToggleReady)return;input.dataset.lbisToggleReady="1";
  const wrap=document.createElement("span");wrap.className="lbis-password-control";input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
  const btn=document.createElement("button");btn.type="button";btn.className="lbis-password-toggle";btn.textContent="👁";btn.title="Show password";btn.setAttribute("aria-label","Show password");
  btn.addEventListener("click",()=>{const visible=input.type==="password";input.type=visible?"text":"password";btn.textContent=visible?"🙈":"👁";btn.title=visible?"Hide password":"Show password";btn.setAttribute("aria-label",btn.title);input.focus();});wrap.appendChild(btn);
 });
})();