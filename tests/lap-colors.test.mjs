import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';

// The lap rule shared with the Mac app and widget (the same cases as its core checks).
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lap-'));const out=path.join(dir,'lap.mjs');
await build({entryPoints:[path.resolve('src/apply/lapColors.ts')],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const {lapOf,lapProgress,lapColor,lapCaption,LAP_CEILING}=await import(out);

test('every goal\'s worth is a new lap: with a goal of 30 it changes at 30, 60, 90, 120, 150, 180',()=>{
 assert.deepEqual([0,29,30,59,60,89,90,119,120,150,179,180,199].map(n=>lapOf(n,30)),[0,0,1,1,2,2,3,3,4,5,5,6,6]);
 assert.deepEqual([9,10,19,20,39,40].map(n=>lapOf(n,10)),[0,1,1,2,3,4]);});

test('the arc starts again at each lap, and a new lap starts empty',()=>{
 assert.equal(lapProgress(5,10),0.5);assert.equal(lapProgress(10,10),0);assert.equal(lapProgress(15,10),0.5);assert.equal(lapProgress(30,10),0);assert.equal(lapProgress(34,10),0.4);assert.equal(lapProgress(0,10),0);});

test('laps stop at 2000 applications and the ring stays full; zero goals and negatives are safe',()=>{
 assert.equal(LAP_CEILING,2000);assert.equal(lapOf(5000,10),200);assert.equal(lapProgress(5000,10),1);assert.equal(lapOf(2000,30),66);
 assert.equal(lapOf(5,0),5);assert.equal(lapOf(-3,10),0);assert.equal(lapProgress(5,0),0);});

test('the first laps keep their meaning (green goal, red double, gold at four) and no two neighbouring laps share a colour up to the last one',()=>{
 assert.equal(lapColor(0),'#6d7bff');assert.equal(lapColor(0,'#123456'),'#123456');assert.equal(lapColor(1),'#2fb87a');assert.equal(lapColor(2),'#ee5d52');assert.equal(lapColor(4),'#f7b838');
 const colours=Array.from({length:201},(_,i)=>lapColor(i));
 for(let i=1;i<colours.length;i++)assert.notEqual(colours[i],colours[i-1],`lap ${i} differs from lap ${i-1}`);
 assert.equal(new Set(colours.slice(1,40)).size,39,'the first 39 laps are all different');
 assert.match(lapColor(30),/^hsl\(/);});

test('captions name the lap and the extra',()=>{
 assert.equal(lapCaption(12,20),'8 to go');assert.equal(lapCaption(20,20),'Goal reached');assert.equal(lapCaption(26,20),'+6 past goal');assert.equal(lapCaption(44,20),'Double goal · +4');assert.equal(lapCaption(199,30),'6× goal · +19');});
