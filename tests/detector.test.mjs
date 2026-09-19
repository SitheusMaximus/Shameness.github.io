import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { locateBoard, classifyBoard } from '../detector.js';
import { PIECE_INFO } from '../solver.js';

const expected = {
  0:'Fire',5:'Earth',7:'Air',8:'Fire',9:'Air',10:'Vitae',11:'Iron',14:'Earth',16:'Fire',17:'Water',19:'Copper',22:'Earth',23:'Mercury',25:'Fire',27:'Vitae',28:'Earth',31:'Water',32:'Earth',33:'Air',34:'Water',35:'Mercury',36:'Fire',37:'Water',38:'Salt',40:'Mors',41:'Earth',44:'Mercury',45:'Gold',46:'Fire',49:'Mercury',50:'Water',52:'Earth',53:'Vitae',54:'Water',55:'Fire',56:'Salt',57:'Earth',58:'Air',59:'Fire',62:'Air',63:'Tin',65:'Mors',67:'Water',68:'Water',71:'Lead',73:'Salt',74:'Air',76:'Mors',79:'Air',80:'Mercury',81:'Salt',82:'Mors',83:'Air',85:'Vitae',90:'Silver'
};

async function readImage(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

for (const file of ['board-faded.png', 'board-bright.png', 'tight.png', 'loose.png', 'wide.png', 'scale_0.75.png', 'scale_1.25.png', 'scale_1.5.png']) {
  const image = await readImage(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)));
  const located = locateBoard(image);
  assert.ok(located, `${file}: board located`);
  const detected = classifyBoard(image, located);
  assert.equal(detected.detected, 55, `${file}: detected 55 occupied cells`);
  let correct = 0;
  for (const [index, name] of Object.entries(expected)) {
    const actual = detected.cells[Number(index)] >= 0 ? PIECE_INFO[detected.cells[Number(index)]].name : null;
    if (actual === name) correct += 1;
    else console.error(`${file}: cell ${index}: expected ${name}, got ${actual}`);
  }
  assert.equal(correct, 55, `${file}: all 55 reference cells classified correctly`);
}

console.log('PASS: real screenshot board localization and 55/55 classification on faded and bright captures');
