// Shared by local speech routing and the wall. Keep dictated note case/punctuation.
export function messageAction(value) {
  const raw=String(value).trim();
  const name="([\\p{L}][\\p{L}'’ -]{0,39}?)";
  let m=raw.match(new RegExp(`^(?:send|text) (?:a )?note to ${name} (?:saying|that says)\\s+(.+)$`,'iu'));
  if(m){let body=m[2].trim();if((body.startsWith('"')&&body.endsWith('"'))||(body.startsWith('“')&&body.endsWith('”')))body=body.slice(1,-1);return {name:'send',input:{recipient:m[1].trim(),kind:'note',text:body}};}
  const t=raw.replace(/[.!?]+$/,'').replace(/,?\s+please$/i,'');
  if(/\b(actually|instead|never mind|cancel)\b/i.test(t))return null;
  m=t.match(new RegExp(`^(?:send|text) (?:the |today['’]s )?(?:daily (?:news )?summary|news summary|daily news|daily briefing) to ${name}$`,'iu'));
  if(m)return {name:'send',input:{recipient:m[1].trim(),kind:'daily'}};
  m=t.match(new RegExp(`^(?:send|text) (?:this|that|it|this trip|this article|this summary|this page) to ${name}$`,'iu'));
  if(m)return {name:'send',input:{recipient:m[1].trim(),kind:'current'}};
  return null;
}
