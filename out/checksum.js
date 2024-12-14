"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
exports.restore = restore;
exports.cleanupOrigFiles = cleanupOrigFiles;
const vscode_1 = __importDefault(require("vscode"));
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const sudo_prompt_1 = __importDefault(require("sudo-prompt"));
const tmp_1 = __importDefault(require("tmp"));
const rootDir = vscode_1.default.env.appRoot;
const appDir = path_1.default.join(rootDir, 'out');
const _appDir = path_1.default.join(rootDir, '..', '..', '_', 'resources', 'app', 'out');
const productFile = path_1.default.join(rootDir, 'product.json');
const _productFile = path_1.default.join(rootDir, '..', '..', '_', 'resources', 'app', 'product.json');
const checksumsFile = path_1.default.join(rootDir, 'out', 'checksums.js');
const origFile = `${productFile}.orig.${vscode_1.default.version}`;
const _origFile = `${_productFile}.orig.${vscode_1.default.version}`;
const messages = {
    // A manual restart is required, as reloading will not take effect.
    changed: verb => `Checksums ${verb}. Please restart VSCode to see effect.`,
    unchanged: 'No changes to checksums were necessary.',
    error: `An error occurred during execution.
Make sure you have write access rights to the VSCode files, see README`,
};
async function apply(context) {
    const product = requireUncached(productFile);
    let changed = false;
    let message = messages.unchanged;
    for (const [filePath, curChecksum] of Object.entries(product.checksums)) {
        const checksum = computeChecksum(path_1.default.join(appDir, ...filePath.split('/')));
        if (checksum !== curChecksum) {
            product.checksums[filePath] = checksum;
            changed = true;
        }
    }
    if (changed) {
        const json = JSON.stringify(product, null, '\t');
        try {
            if (!fs.existsSync(origFile)) {
                await moveFile(productFile, origFile);
            }
            await writeFile(productFile, json);
            // try{
            //     fs.rmSync(checksumsFile);
            // } catch {}
            // const text = `export const checksums = ${JSON.stringify(product.checksums)}`
            // await writeFile(checksumsFile, text);
        }
        catch (err) {
            console.error(err);
            message = messages.error;
            vscode_1.default.window.showErrorMessage(message);
        }
    }
}
;
async function restore() {
    let message = messages.unchanged;
    try {
        if (fs.existsSync(origFile)) {
            await deleteFile(productFile);
            await moveFile(origFile, productFile);
        }
    }
    catch (err) {
        console.error(err);
        message = messages.error;
        vscode_1.default.window.showErrorMessage(message);
    }
}
;
function computeChecksum(file) {
    let contents = fs.readFileSync(file);
    return crypto_1.default
        .createHash('sha256')
        .update(contents)
        .digest('base64')
        .replace(/=+$/, '');
}
function cleanupOrigFiles() {
    // Remove all old backup files that aren't related to the current version
    // of VSCode anymore.
    const oldOrigFiles = fs.readdirSync(rootDir)
        .filter(file => /\.orig\./.test(file))
        .filter(file => !file.endsWith(vscode_1.default.version));
    for (const file of oldOrigFiles) {
        deleteFileAdmin(path_1.default.join(rootDir, file));
    }
}
function writeFile(filePath, writeString, encoding = "UTF-8") {
    return new Promise((resolve, reject) => {
        try {
            fs.writeFileSync(filePath, writeString, { encoding: "utf8" });
            resolve();
        }
        catch (err) {
            console.error(err);
            writeFileAdmin(filePath, writeString, encoding).then(resolve).catch(reject);
        }
    });
}
function writeFileAdmin(filePath, writeString, encoding = "UTF-8", promptName = "File Writer") {
    console.info("Writing file with administrator privileges ...");
    return new Promise((resolve, reject) => {
        tmp_1.default.file((err, tmpPath) => {
            if (err)
                reject(err);
            else
                fs.writeFile(tmpPath, writeString, { encoding: "utf8" }, err => {
                    if (err)
                        reject(err);
                    else
                        sudo_prompt_1.default.exec((process.platform === "win32" ? "copy /y " : "cp -f ") + `"${tmpPath}" "${filePath}"`, { name: promptName }, error => {
                            if (error)
                                reject(error);
                            else
                                resolve();
                        });
                });
        });
    });
}
function deleteFile(filePath) {
    return new Promise((resolve, reject) => {
        try {
            fs.unlinkSync(filePath);
            resolve();
        }
        catch (err) {
            console.error(err);
            deleteFileAdmin(filePath).then(resolve).catch(reject);
        }
    });
}
function deleteFileAdmin(filePath, promptName = "File Deleter") {
    console.info("Deleting file with administrator privileges ...");
    return new Promise((resolve, reject) => {
        sudo_prompt_1.default.exec((process.platform === "win32" ? "del /f /q " : "rm -f ") + `"${filePath}"`, { name: promptName }, error => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function moveFile(filePath, newPath) {
    return new Promise((resolve, reject) => {
        try {
            fs.renameSync(filePath, newPath);
            resolve();
        }
        catch (err) {
            console.error(err);
            moveFileAdmin(filePath, newPath).then(resolve).catch(reject);
        }
    });
}
function moveFileAdmin(filePath, newPath, promptName = "File Renamer") {
    console.info("Renaming file with administrator privileges ...");
    return new Promise((resolve, reject) => {
        sudo_prompt_1.default.exec((process.platform === "win32" ? "move /y " : "mv -f ") + `"${filePath}" "${newPath}"`, { name: promptName }, error => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function requireUncached(module) {
    delete require.cache[require.resolve(module)];
    return require(module);
}
//# sourceMappingURL=checksum.js.map