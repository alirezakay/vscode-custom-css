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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode_1 = __importDefault(require("vscode"));
const fs = __importStar(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const messages_1 = require("./messages");
const uuid_1 = require("uuid");
const node_fetch_1 = __importDefault(require("node-fetch"));
const url_1 = __importDefault(require("url"));
const checksum_1 = require("./checksum");
async function activate(context) {
    context.subscriptions.push(vscode_1.default.commands.registerCommand('vccsilent.apply', checksum_1.apply), vscode_1.default.commands.registerCommand('vccsilent.restore', checksum_1.restore));
    (0, checksum_1.cleanupOrigFiles)();
    await (0, checksum_1.apply)(context);
    const status = await context.secrets.get('status') || "";
    if (!status || !['enabled', 'disabled', 'pending'].includes(status)) {
        await context.secrets.store('status', 'enabled');
    }
    const appDir = require.main
        ? path_1.default.dirname(require.main.filename)
        : globalThis._VSCODE_FILE_ROOT;
    if (!appDir) {
        vscode_1.default.window.showInformationMessage(messages_1.messages.unableToLocateVsCodeInstallationPath);
    }
    const base = path_1.default.join(appDir, "vs", "code");
    let htmlFile = path_1.default.join(base, "electron-sandbox", "workbench", "workbench.html");
    if (!fs.existsSync(htmlFile)) {
        htmlFile = path_1.default.join(base, "electron-sandbox", "workbench", "workbench.esm.html");
    }
    if (!fs.existsSync(htmlFile)) {
        vscode_1.default.window.showInformationMessage(messages_1.messages.unableToLocateVsCodeInstallationPath);
    }
    const BackupFilePath = uuid => path_1.default.join(base, "electron-sandbox", "workbench", `workbench.${uuid}.bak-custom-css`);
    function resolveVariable(key) {
        const variables = {
            cwd: () => process.cwd(),
            userHome: () => os_1.default.homedir(),
            execPath: () => process.env.VSCODE_EXEC_PATH ?? process.execPath,
            pathSeparator: () => path_1.default.sep,
            "/": () => path_1.default.sep,
        };
        if (key in variables)
            return variables[key]();
        if (key.startsWith('env:')) {
            const [_, envKey, optionalDefault] = key.split(':');
            return process.env[envKey] ?? optionalDefault ?? '';
        }
    }
    function parsedUrl(url) {
        if (/^file:/.test(url)) {
            // regex matches any "${<RESOLVE>}" and replaces with resolveVariable(<RESOLVE>)
            // eg:  "HELLO ${userHome} WORLD" -> "HELLO /home/username WORLD"
            const resolved = url.replaceAll(/\$\{([^\{\}]+)\}/g, (substr, key) => resolveVariable(key) ?? substr);
            return resolved;
        }
        else {
            return url;
        }
    }
    async function getContent(url) {
        if (/^file:/.test(url.toString())) {
            const p = url_1.default.fileURLToPath(url);
            return fs.readFileSync(p);
        }
        else {
            const response = await (0, node_fetch_1.default)(url);
            return response.buffer();
        }
    }
    // ####  main commands ######################################################
    async function cmdInstall() {
        await context.secrets.store('status', 'pending');
        const uuidSession = (0, uuid_1.v4)();
        await createBackup(uuidSession);
        await performPatch(uuidSession);
        await (0, checksum_1.apply)(context);
        await context.secrets.store('status', 'enabled');
        reloadWindow();
    }
    async function cmdReinstall() {
        await uninstallImpl();
        await cmdInstall();
    }
    async function cmdUninstall() {
        await context.secrets.store('status', 'pending');
        await uninstallImpl();
        await (0, checksum_1.apply)(context);
        await context.secrets.store('status', 'disabled');
        reloadWindow();
    }
    async function uninstallImpl() {
        const backupUuid = await getBackupUuid(htmlFile);
        if (!backupUuid)
            return;
        const backupPath = BackupFilePath(backupUuid);
        await restoreBackup(backupPath);
        await deleteBackupFiles();
    }
    // #### Backup ################################################################
    async function getBackupUuid(htmlFilePath) {
        try {
            const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");
            const m = htmlContent.match(/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ([0-9a-fA-F-]+) !! -->/);
            if (!m)
                return null;
            else
                return m[1];
        }
        catch (e) {
            vscode_1.default.window.showInformationMessage(messages_1.messages.somethingWrong + e);
            throw e;
        }
    }
    async function createBackup(uuidSession) {
        try {
            let html = fs.readFileSync(htmlFile, "utf-8");
            html = clearExistingPatches(html);
            fs.writeFileSync(BackupFilePath(uuidSession), html, "utf-8");
        }
        catch (e) {
            vscode_1.default.window.showInformationMessage(messages_1.messages.admin);
            throw e;
        }
    }
    async function restoreBackup(backupFilePath) {
        try {
            if (fs.existsSync(backupFilePath)) {
                await fs.unlinkSync(htmlFile);
                await fs.copyFileSync(backupFilePath, htmlFile);
                fs;
            }
        }
        catch (e) {
            vscode_1.default.window.showInformationMessage(messages_1.messages.admin);
            throw e;
        }
    }
    async function deleteBackupFiles() {
        const htmlDir = path_1.default.dirname(htmlFile);
        const htmlDirItems = await fs.promises.readdir(htmlDir);
        for (const item of htmlDirItems) {
            if (item.endsWith(".bak-custom-css")) {
                await fs.promises.unlink(path_1.default.join(htmlDir, item));
            }
        }
    }
    // #### Patching ##############################################################
    async function performPatch(uuidSession) {
        const config = vscode_1.default.workspace.getConfiguration("vscode_custom_css_silent");
        if (!patchIsProperlyConfigured(config)) {
            return vscode_1.default.window.showInformationMessage(messages_1.messages.notConfigured);
        }
        let html = fs.readFileSync(htmlFile, "utf-8");
        html = clearExistingPatches(html);
        const injectHTML = await patchHtml(config);
        html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");
        let indicatorJS = "";
        if (config.statusbar)
            indicatorJS = await getIndicatorJs();
        html = html.replace(/(<\/html>)/, `<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ${uuidSession} !! -->\n` +
            "<!-- !! VSCODE-CUSTOM-CSS-START !! -->\n" +
            indicatorJS +
            injectHTML +
            "<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n</html>");
        try {
            fs.writeFileSync(htmlFile, html, "utf-8");
        }
        catch (e) {
            vscode_1.default.window.showInformationMessage(messages_1.messages.admin);
            return;
        }
    }
    function clearExistingPatches(html) {
        html = html.replace(/<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n*/, "");
        html = html.replace(/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\w-]+ !! -->\n*/g, "");
        return html;
    }
    function patchIsProperlyConfigured(config) {
        return config && config.imports && config.imports instanceof Array;
    }
    async function patchHtml(config) {
        let res = "";
        for (const item of config.imports) {
            const imp = await patchHtmlForItem(item);
            if (imp)
                res += imp;
        }
        return res;
    }
    async function patchHtmlForItem(url) {
        if (!url)
            return "";
        if (typeof url !== "string")
            return "";
        // Copy the resource to a staging directory inside the extension dir
        let parsed = new url_1.default.URL(url);
        const ext = path_1.default.extname(parsed.pathname);
        try {
            parsed = parsedUrl(url);
            const fetched = await getContent(parsed);
            if (ext === ".css") {
                return `<style>${fetched}</style>`;
            }
            else if (ext === ".js") {
                return `<script>${fetched}</script>`;
            }
            throw new Error(`Unsupported extension type: ${ext}`);
        }
        catch (e) {
            console.error(e);
            vscode_1.default.window.showWarningMessage(messages_1.messages.cannotLoad(parsed.toString()));
            return "";
        }
    }
    async function getIndicatorJs() {
        let indicatorJsPath;
        let ext = vscode_1.default.extensions.getExtension("alirezakay.vscode-custom-css-silent");
        if (ext && ext.extensionPath) {
            indicatorJsPath = path_1.default.resolve(ext.extensionPath, "src/statusbar.js");
        }
        else {
            indicatorJsPath = path_1.default.resolve(__dirname, "statusbar.js");
        }
        const indicatorJsContent = fs.readFileSync(indicatorJsPath, "utf-8");
        return `<script>${indicatorJsContent}</script>`;
    }
    function reloadWindow() {
        vscode_1.default.commands.executeCommand("workbench.action.reloadWindow");
    }
    const installCustomCSS = vscode_1.default.commands.registerCommand("vccsilent.installCustomCSS", cmdInstall);
    const uninstallCustomCSS = vscode_1.default.commands.registerCommand("vccsilent.uninstallCustomCSS", cmdUninstall);
    const updateCustomCSS = vscode_1.default.commands.registerCommand("vccsilent.updateCustomCSS", cmdReinstall);
    const checkCustomCSS = vscode_1.default.commands.registerCommand("vccsilent.checkCustomCSS", async () => {
        const status = await context.secrets.get('status') || "";
        if (!status) {
            return;
        }
        const interv = setInterval(async () => {
            const status = await context.secrets.get('status') || "";
            if (status === 'pending') {
                return;
            }
            clearInterval(interv);
            const content = fs.readFileSync(htmlFile, "utf-8");
            try {
                const doesHave = content.includes("<!-- !! VSCODE-CUSTOM-CSS-START !! -->");
                if (status === "enabled" && !doesHave) {
                    await cmdReinstall();
                }
                else if (status === "disabled" && doesHave) {
                    await cmdUninstall();
                }
            }
            catch (err) {
                console.error(err);
            }
        }, 100);
    });
    const getStatus = vscode_1.default.commands.registerCommand("vccsilent.getStatus", async () => {
        let status = await context.secrets.get('status') || "";
        if (!status) {
            return;
        }
        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        while (status === 'pending') {
            console.log("kir");
            await sleep(100);
            status = await context.secrets.get('status') || "";
            continue;
        }
        return status;
    });
    context.subscriptions.push(installCustomCSS);
    context.subscriptions.push(uninstallCustomCSS);
    context.subscriptions.push(updateCustomCSS);
    // context.subscriptions.push(checkCustomCSS);
    const previousVersion = context.globalState.get('vscodeVersion');
    const currentVersion = vscode_1.default.version;
    if (previousVersion !== currentVersion) {
        context.globalState.update('vscodeVersion', currentVersion);
        if (previousVersion) {
            try {
                await cmdReinstall();
            }
            catch { }
        }
    }
    console.log("vscode-custom-css-silent is active!");
    console.log("Application directory", appDir);
    console.log("Main HTML file", htmlFile);
}
async function deactivate(context) {
    await vscode_1.default.commands.executeCommand("vccsilent.uninstallCustomCSS");
}
//# sourceMappingURL=extension.js.map