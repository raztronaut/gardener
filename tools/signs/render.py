"""Deterministic Directive composition; text and branding never come from an image model."""
import json, sys, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

INK=(26,24,24)
RESAMPLE=getattr(Image,'Resampling',Image).LANCZOS
TRANSPOSE=getattr(Image,'Transpose',Image)
FONT='/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf'

def lines(text,font,width):
    result=[]
    for paragraph in text.split('\n'):
        current=''
        for word in paragraph.split():
            if font.getlength(word)>width: return None
            next_line=(current+' '+word).strip()
            if current and font.getlength(next_line)>width:result.append(current);current=word
            else:current=next_line
        result.append(current)
    return result

def fitted(text,max_size,min_size,width,max_lines):
    for size in range(max_size,min_size-1,-2):
        font=ImageFont.truetype(FONT,size)
        wrapped=lines(text,font,width)
        if wrapped is not None and len(wrapped)<=max_lines:return font,wrapped,size
    raise ValueError('This copy is too long for a legible sign. Shorten it before previewing.')

def render(spec,out,assets):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    width,height=3300,2550
    im=Image.new('RGB',(width,height),'white');d=ImageDraw.Draw(im)
    layout=spec.get('layout',{})
    margin=max(75,int(layout.get('safeMargin',75)))
    font=ImageFont.truetype(FONT,135)
    key='<'+spec['eyebrow'].strip('<> ').lower()+'>'
    if font.getlength(key)>width-2*margin:raise ValueError('The key is too long.')
    d.text((margin,int(layout.get('keyTop',100))),key,font=font,fill=INK,anchor='lt')
    art=spec.get('illustration','lifecycle')
    if art!='none':
        if not spec.get('illustrationFile'):raise ValueError('An image-model illustration is required; no hardcoded substitute is available.')
        raw=Image.open(spec['illustrationFile']).convert('RGBA')
        picture=Image.new('RGB',raw.size,'white');picture.paste(raw,mask=raw.getchannel('A'))
        art_width=int(layout.get('illustrationWidth',850));art_height=int(layout.get('illustrationHeight',650))
        picture.thumbnail((art_width,art_height),RESAMPLE)
        im.paste(picture,((width-picture.width)//2,int(layout.get('illustrationTop',350))+(art_height-picture.height)//2))
    top=int(layout.get('headlineTop',1070))
    fit=None
    for size in range(int(layout.get('headlineMaxSize',210)),139,-2):
        main=ImageFont.truetype(FONT,size);wrapped=lines(spec['headline'],main,width-2*max(150,margin))
        if wrapped is None or len(wrapped)>3:continue
        for sub_size in range(107,75,-2):
            sub=ImageFont.truetype(FONT,sub_size);sub_lines=lines(spec.get('subphrase',''),sub,width-2*max(160,margin)) if spec.get('subphrase') else []
            if sub_lines is None or len(sub_lines)>3:continue
            total=round(size*1.15)*len(wrapped)
            if top+total+38+len(sub_lines)*sub_size*1.2<=1920:
                fit=(main,wrapped,size,sub,sub_lines,sub_size,total);break
        if fit:break
    if not fit:raise ValueError('The text needs shortening to keep the sign legible and clear of the logo.')
    main,wrapped,size,sub,sub_lines,sub_size,total=fit;line_height=round(size*1.15)
    bounds=[]
    for i,line in enumerate(wrapped):
        xy=(width/2,top+i*line_height);d.text(xy,line,font=main,fill=INK,anchor='mt');bounds.append(d.textbbox(xy,line,font=main,anchor='mt'))
    sub_top=top+total+38
    if spec.get('subphrase') in ['↓','↑']:
        x=width//2;y=int(sub_top);direction=1 if spec['subphrase']=='↓' else -1
        if direction<0:y+=150
        d.line((x,y,x,y+150*direction),fill=INK,width=17);d.line((x-45,y+105*direction,x,y+150*direction,x+45,y+105*direction),fill=INK,width=17)
    else:
        for i,line in enumerate(sub_lines):
            xy=(width/2,sub_top+i*sub_size*1.2);d.text(xy,line,font=sub,fill=INK,anchor='mt');bounds.append(d.textbbox(xy,line,font=sub,anchor='mt'))
    logo_name=spec.get('logo','directive')
    logo=Image.open(spec.get('logoFile') or Path(assets)/('directive-lockup.png' if logo_name=='directive' else logo_name+'.png')).convert('RGBA')
    logo.thumbnail((int(layout.get('logoWidth',779)),int(layout.get('logoHeight',373))),RESAMPLE)
    im.paste(logo,(width-margin-logo.width,height-margin-logo.height),logo)
    for b in bounds:
        if b[0]<margin or b[2]>width-margin:raise ValueError('Text would cross the print-safe margin.')
    # The printer advertises portrait only. Rotate the entire approved composition
    # once, then show those exact JPEG bytes rotated back in the UI.
    # Household policy: every print, including original branding, is monochrome.
    portrait=im.convert('L').transpose(TRANSPOSE.ROTATE_90)
    portrait.save(out/'print.jpg',quality=98,subsampling=0,dpi=(300,300))
    approved=Image.open(out/'print.jpg')
    approved.transpose(TRANSPOSE.ROTATE_270).save(out/'preview.png')
    # PDF uses the approved raster, not another layout pass.
    approved.transpose(TRANSPOSE.ROTATE_270).save(out/'sign.pdf',resolution=300,quality=98,subsampling=0)
    report={'width':width,'height':height,'dpi':300,'colorMode':'monochrome','paper':'na_letter_8.5x11in','font':'Nimbus Sans Bold (Helvetica-compatible; PSD references Helvetica-Bold)','headlineSize':size,'subphraseSize':sub_size,'textBounds':bounds,'safeMargin':margin}
    (out/'layout.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    spec=json.loads(Path(sys.argv[1]).read_text());print(json.dumps(render(spec,sys.argv[2],sys.argv[3])))
