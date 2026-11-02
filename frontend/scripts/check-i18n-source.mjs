/** Check authored resource references and language metadata without executing UI code. */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.join(frontend,'src');
const resources=JSON.parse(fs.readFileSync(path.join(root,'i18n/resources/zh-Hans.json'),'utf8'));
const registry=JSON.parse(fs.readFileSync(path.join(frontend,'../server/ui_languages.json'),'utf8'));
const errors=[];
for(const language of registry){
 try {
  for(const field of ['id','html','format'])if(new Intl.Locale(language[field]).baseName!==language[field])errors.push(`${language.id}: ${field} must be a canonical BCP 47 tag`);
  const actual=new Intl.PluralRules(language.id).resolvedOptions().pluralCategories.sort();
  if(language.complete && JSON.stringify([...language.plurals].sort())!==JSON.stringify(actual))errors.push(`${language.id}: expected plural forms ${actual.join(', ')}`);
 } catch {errors.push(`${language.id}: invalid locale`);}
}
function walk(directory){
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()){if(!['i18n','mocks','generated'].includes(entry.name))walk(file);continue;}
  if(!/\.tsx?$/.test(file)||/\.test\./.test(file))continue;
  const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node){
   if(ts.isCallExpression(node)&&/^(t|message|describeMessage|i18n.t)$/.test(node.expression.getText(ast))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
    const key=node.arguments[0].text;
    if(!(key in resources)&&!(`${key}_other` in resources))errors.push(`${path.relative(frontend,file)}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1}: missing required message ${key}`);
   }
   ts.forEachChild(node,visit);
  }
  visit(ast);
 }
}
walk(root);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log('Language registry and literal message references are valid.');
