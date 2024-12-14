import { ExtensionContext } from "vscode";

import vscode from 'vscode';
import * as fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sudo from 'sudo-prompt';
import tmp from "tmp";

const rootDir = vscode.env.appRoot;
const appDir = path.join(rootDir, 'out');
const _appDir = path.join(rootDir, '..', '..', '_', 'resources', 'app', 'out');

const productFile = path.join(rootDir, 'product.json');
const _productFile = path.join(rootDir, '..', '..', '_', 'resources', 'app', 'product.json');
const checksumsFile = path.join(rootDir, 'out', 'checksums.js');
const origFile = `${productFile}.orig.${vscode.version}`;
const _origFile = `${_productFile}.orig.${vscode.version}`;

const messages = {
    // A manual restart is required, as reloading will not take effect.
    changed: verb => `Checksums ${verb}. Please restart VSCode to see effect.`,
    unchanged: 'No changes to checksums were necessary.',
    error: `An error occurred during execution.
Make sure you have write access rights to the VSCode files, see README`,
};

export async function apply(context: ExtensionContext) {
    const product = requireUncached(productFile);
    let changed = false;
    let message = messages.unchanged;
    for (const [filePath, curChecksum] of Object.entries(product.checksums)) {
        const checksum = computeChecksum(path.join(appDir, ...filePath.split('/')));
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
        } catch (err) {
            console.error(err);
            message = messages.error;
            vscode.window.showErrorMessage(message);
        }
    }
};

export async function restore() {
    let message = messages.unchanged;
    try {
        if (fs.existsSync(origFile)) {
            await deleteFile(productFile);
            await moveFile(origFile, productFile);
        }
    } catch (err) {
        console.error(err);
        message = messages.error;
        vscode.window.showErrorMessage(message);
    }
};

function computeChecksum(file) {
    let contents = fs.readFileSync(file);
    return crypto
        .createHash('sha256')
        .update(contents)
        .digest('base64')
        .replace(/=+$/, '');
}

export function cleanupOrigFiles() {
    // Remove all old backup files that aren't related to the current version
    // of VSCode anymore.
    const oldOrigFiles = fs.readdirSync(rootDir)
        .filter(file => /\.orig\./.test(file))
        .filter(file => !file.endsWith(vscode.version));
    for (const file of oldOrigFiles) {
        deleteFileAdmin(path.join(rootDir, file));
    }
}

function writeFile(filePath, writeString, encoding = "UTF-8") {
    return new Promise<void>((resolve, reject) => {
        try {
            fs.writeFileSync(filePath, writeString, { encoding: "utf8" });
            resolve();
        } catch (err) {
            console.error(err);
            writeFileAdmin(filePath, writeString, encoding).then(resolve).catch(reject);
        }
    });
}

function writeFileAdmin(filePath, writeString, encoding = "UTF-8", promptName = "File Writer") {
    console.info("Writing file with administrator privileges ...");
    return new Promise<void>((resolve, reject) => {
        tmp.file((err, tmpPath) => {
            if (err) reject(err);
            else fs.writeFile(tmpPath, writeString, { encoding: "utf8" }, err => {
                if (err) reject(err);
                else sudo.exec(
                    (process.platform === "win32" ? "copy /y " : "cp -f ") + `"${tmpPath}" "${filePath}"`,
                    { name: promptName },
                    error => {
                        if (error) reject(error);
                        else resolve();
                    });
            });
        });
    });
}

function deleteFile(filePath) {
    return new Promise<void>((resolve, reject) => {
        try {
            fs.unlinkSync(filePath);
            resolve();
        } catch (err) {
            console.error(err);
            deleteFileAdmin(filePath).then(resolve).catch(reject);
        }
    });
}

function deleteFileAdmin(filePath, promptName = "File Deleter") {
    console.info("Deleting file with administrator privileges ...");
    return new Promise<void>((resolve, reject) => {
        sudo.exec(
            (process.platform === "win32" ? "del /f /q " : "rm -f ") + `"${filePath}"`,
            { name: promptName },
            error => {
                if (error) reject(error);
                else resolve();
            }
        );
    });
}

function moveFile(filePath, newPath) {
    return new Promise<void>((resolve, reject) => {
        try {
            fs.renameSync(filePath, newPath);
            resolve();
        } catch (err) {
            console.error(err);
            moveFileAdmin(filePath, newPath).then(resolve).catch(reject);
        }
    });
}

function moveFileAdmin(filePath, newPath, promptName = "File Renamer") {
    console.info("Renaming file with administrator privileges ...");
    return new Promise<void>((resolve, reject) => {
        sudo.exec(
            (process.platform === "win32" ? "move /y " : "mv -f ") + `"${filePath}" "${newPath}"`,
            { name: promptName },
            error => {
                if (error) reject(error);
                else resolve();
            }
        );
    });
}

function requireUncached(module) {
    delete require.cache[require.resolve(module)];
    return require(module);
}
