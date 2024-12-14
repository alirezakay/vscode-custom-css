import vscode, { ExtensionContext } from "vscode";
import * as fs from 'fs';
import os from "os";
import path from "path";
import { messages as msg } from './messages';
import { v4 as uuid } from "uuid";
import fetch from "node-fetch";
import Url from "url";
import { apply, restore, cleanupOrigFiles } from "./checksum";


export async function activate(context: ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('vccsilent.apply', apply),
		vscode.commands.registerCommand('vccsilent.restore', restore)
	)
	cleanupOrigFiles();
	await apply(context);


	const status = await context.secrets.get('status') || "";
	if (!status || !['enabled', 'disabled', 'pending'].includes(status)) {
		await context.secrets.store('status', 'enabled');
	}

	const appDir = require.main
		? path.dirname(require.main.filename)
		: globalThis._VSCODE_FILE_ROOT;
	if (!appDir) {
		vscode.window.showInformationMessage(msg.unableToLocateVsCodeInstallationPath);
	}

	const base = path.join(appDir, "vs", "code");
	let htmlFile = path.join(base, "electron-sandbox", "workbench", "workbench.html");
	if (!fs.existsSync(htmlFile)) {
		htmlFile = path.join(base, "electron-sandbox", "workbench", "workbench.esm.html");
	}
	if (!fs.existsSync(htmlFile)) {
		vscode.window.showInformationMessage(msg.unableToLocateVsCodeInstallationPath);
	}
	const BackupFilePath = uuid =>
		path.join(base, "electron-sandbox", "workbench", `workbench.${uuid}.bak-custom-css`);

	function resolveVariable(key) {
		const variables = {
			cwd: () => process.cwd(),
			userHome: () => os.homedir(),
			execPath: () => process.env.VSCODE_EXEC_PATH ?? process.execPath,
			pathSeparator: () => path.sep,
			"/": () => path.sep,
		};

		if (key in variables) return variables[key]();

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
		} else {
			return url
		}
	}

	async function getContent(url) {
		if (/^file:/.test(url.toString())) {
			const p = Url.fileURLToPath(url);
			return fs.readFileSync(p);
		} else {
			const response = await fetch(url);
			return response.buffer();
		}
	}

	// ####  main commands ######################################################

	async function cmdInstall() {
		await context.secrets.store('status', 'pending');
		const uuidSession = uuid();
		await createBackup(uuidSession);
		await performPatch(uuidSession);
		await apply(context);
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
		await apply(context);
		await context.secrets.store('status', 'disabled');
		reloadWindow();
	}

	async function uninstallImpl() {
		const backupUuid = await getBackupUuid(htmlFile);
		if (!backupUuid) return;
		const backupPath = BackupFilePath(backupUuid);
		await restoreBackup(backupPath);
		await deleteBackupFiles();
	}

	// #### Backup ################################################################

	async function getBackupUuid(htmlFilePath) {
		try {
			const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");
			const m = htmlContent.match(
				/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ([0-9a-fA-F-]+) !! -->/
			);
			if (!m) return null;
			else return m[1];
		} catch (e) {
			vscode.window.showInformationMessage(msg.somethingWrong + e);
			throw e;
		}
	}

	async function createBackup(uuidSession) {
		try {
			let html = fs.readFileSync(htmlFile, "utf-8");
			html = clearExistingPatches(html);
			fs.writeFileSync(BackupFilePath(uuidSession), html, "utf-8");
		} catch (e) {
			vscode.window.showInformationMessage(msg.admin);
			throw e;
		}
	}

	async function restoreBackup(backupFilePath) {
		try {
			if (fs.existsSync(backupFilePath)) {
				await fs.unlinkSync(htmlFile);
				await fs.copyFileSync(backupFilePath, htmlFile);
				fs
			}
		} catch (e) {
			vscode.window.showInformationMessage(msg.admin);
			throw e;
		}
	}

	async function deleteBackupFiles() {
		const htmlDir = path.dirname(htmlFile);
		const htmlDirItems = await fs.promises.readdir(htmlDir);
		for (const item of htmlDirItems) {
			if (item.endsWith(".bak-custom-css")) {
				await fs.promises.unlink(path.join(htmlDir, item));
			}
		}
	}

	// #### Patching ##############################################################

	async function performPatch(uuidSession) {
		const config = vscode.workspace.getConfiguration("vscode_custom_css_silent");
		if (!patchIsProperlyConfigured(config)) {
			return vscode.window.showInformationMessage(msg.notConfigured);
		}

		let html = fs.readFileSync(htmlFile, "utf-8");
		html = clearExistingPatches(html);

		const injectHTML = await patchHtml(config);
		html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");

		let indicatorJS = "";
		if (config.statusbar) indicatorJS = await getIndicatorJs();

		html = html.replace(
			/(<\/html>)/,
			`<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID ${uuidSession} !! -->\n` +
			"<!-- !! VSCODE-CUSTOM-CSS-START !! -->\n" +
			indicatorJS +
			injectHTML +
			"<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n</html>"
		);
		try {
			fs.writeFileSync(htmlFile, html, "utf-8");
		} catch (e) {
			vscode.window.showInformationMessage(msg.admin);
			return
		}
	}

	function clearExistingPatches(html) {
		html = html.replace(
			/<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n*/,
			""
		);
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
			if (imp) res += imp;
		}
		return res;
	}
	async function patchHtmlForItem(url) {
		if (!url) return "";
		if (typeof url !== "string") return "";

		// Copy the resource to a staging directory inside the extension dir
		let parsed = new Url.URL(url);
		const ext = path.extname(parsed.pathname);

		try {
			parsed = parsedUrl(url)
			const fetched = await getContent(parsed);
			if (ext === ".css") {
				return `<style>${fetched}</style>`;
			} else if (ext === ".js") {
				return `<script>${fetched}</script>`;
			}
			throw new Error(`Unsupported extension type: ${ext}`);
		} catch (e) {
			console.error(e);
			vscode.window.showWarningMessage(msg.cannotLoad(parsed.toString()));
			return "";
		}
	}
	async function getIndicatorJs() {
		let indicatorJsPath;
		let ext = vscode.extensions.getExtension("alirezakay.vscode-custom-css-silent");
		if (ext && ext.extensionPath) {
			indicatorJsPath = path.resolve(ext.extensionPath, "src/statusbar.js");
		} else {
			indicatorJsPath = path.resolve(__dirname, "statusbar.js");
		}
		const indicatorJsContent = fs.readFileSync(indicatorJsPath, "utf-8");
		return `<script>${indicatorJsContent}</script>`;
	}

	function reloadWindow() {
		vscode.commands.executeCommand("workbench.action.reloadWindow");
	}

	const installCustomCSS = vscode.commands.registerCommand(
		"vccsilent.installCustomCSS",
		cmdInstall
	);
	const uninstallCustomCSS = vscode.commands.registerCommand(
		"vccsilent.uninstallCustomCSS",
		cmdUninstall
	);
	const updateCustomCSS = vscode.commands.registerCommand(
		"vccsilent.updateCustomCSS",
		cmdReinstall
	);
	const checkCustomCSS = vscode.commands.registerCommand(
		"vccsilent.checkCustomCSS",
		async () => {
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
				} catch (err) {
					console.error(err);
				}
			}, 100);
		}
	);
	const getStatus = vscode.commands.registerCommand(
		"vccsilent.getStatus",
		async () => {
			let status = await context.secrets.get('status') || "";
			if (!status) {
				return;
			}
			function sleep(ms: number) {
				return new Promise(resolve => setTimeout(resolve, ms));
			}
			while (status === 'pending') {
				console.log("kir");

				await sleep(100);
				status = await context.secrets.get('status') || "";
				continue
			}
			return status;
		}
	);

	context.subscriptions.push(installCustomCSS);
	context.subscriptions.push(uninstallCustomCSS);
	context.subscriptions.push(updateCustomCSS);
	// context.subscriptions.push(checkCustomCSS);

	const previousVersion = context.globalState.get('vscodeVersion');
	const currentVersion = vscode.version;
	if (previousVersion !== currentVersion) {
		context.globalState.update('vscodeVersion', currentVersion);
		if (previousVersion) {
			try {
				await cmdReinstall();
			} catch { }
		}
	}

	console.log("vscode-custom-css-silent is active!");
	console.log("Application directory", appDir);
	console.log("Main HTML file", htmlFile);
}

export async function deactivate(context: vscode.ExtensionContext) {
	await vscode.commands.executeCommand("vccsilent.uninstallCustomCSS");
}
