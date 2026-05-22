const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'vercel.json');
const targetDir = path.join(rootDir, 'dist');
const targetPath = path.join(targetDir, 'vercel.json');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const staticConfig = { ...source };

delete staticConfig.installCommand;
delete staticConfig.buildCommand;
delete staticConfig.outputDirectory;

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetPath, `${JSON.stringify(staticConfig, null, 2)}\n`);
