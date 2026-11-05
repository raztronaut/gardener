import { TOKEN_CONTRACT, TOKEN_GROUPS } from './design-contract.js';
export function themeSchema() {
  const cssValue={type:'string',minLength:1,maxLength:8000,pattern:'^[^{};<>\\x00-\\x1f]+$'};
  const declarations={type:'object',propertyNames:{pattern:'^(--[a-z][a-z0-9-]*|-?[a-z][a-z0-9-]*)$'},additionalProperties:cssValue};
  const tokens={type:'object',additionalProperties:false,properties:{}};
  for(const group of TOKEN_GROUPS){
    if(group==='palette'||group==='overrides'){
      tokens.properties[group]={type:'object',propertyNames:{pattern:group==='palette'?'^--palette-[a-z0-9-]+$':'^--ds-[a-z0-9-]+$'},additionalProperties:cssValue};
    }else{
      const properties={};
      for(const [name,info] of Object.entries(TOKEN_CONTRACT))if(info.group===group){
        properties[name]={...cssValue,description:info.description};
        for(const alias of info.aliases)properties[alias]={...cssValue,deprecated:true,description:'Use '+name};
      }
      tokens.properties[group]={type:'object',properties,additionalProperties:false};
    }
  }
  return {$schema:'https://json-schema.org/draft/2020-12/schema',title:'GardenOS theme',type:'object',required:['version','id'],additionalProperties:false,
    properties:{
      $schema:{type:'string'},version:{const:1},id:{type:'string',pattern:'^[a-z][a-z0-9-]*$'},label:{type:'string'},description:{type:'string'},tokens,
      layout:{type:'object',additionalProperties:false,properties:{columns:{type:'integer',minimum:1,maximum:12},rowSize:cssValue,align:{enum:['start','end','center','stretch','space-between','space-around','space-evenly']}}},
      components:{type:'object',propertyNames:{pattern:'^[a-z][a-z0-9-]*$'},additionalProperties:{type:'object',required:['selector','style'],additionalProperties:false,properties:{description:{type:'string'},selector:{type:'string',minLength:1},style:declarations}}},
      widgets:{type:'object',propertyNames:{pattern:'^[a-z][a-z0-9-]*$'},additionalProperties:{type:'object',additionalProperties:false,properties:{
        description:{type:'string'},columns:{type:'integer',minimum:1,maximum:12},rows:{type:'integer',minimum:1,maximum:20},order:{type:'integer'},hidden:{type:'boolean'},
        style:declarations,tokens:{type:'object',propertyNames:{pattern:'^--[a-z][a-z0-9-]*$'},additionalProperties:cssValue},
        parts:{type:'object',additionalProperties:declarations},
      }}},
    },
  };
}
