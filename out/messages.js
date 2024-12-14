"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messages = void 0;
exports.messages = {
    admin: "Run VS Code with admin privileges so the changes can be applied.",
    enabled: "Custom CSS and JS enabled.\nRestart to take effect.",
    disabled: "Custom CSS and JS disabled and reverted to default.\nRestart to take effect.",
    already_disabled: "Custom CSS and JS already disabled.",
    somethingWrong: "Something went wrong: ",
    restartIde: "Restart Visual Studio Code",
    notfound: "Custom CSS and JS not found.",
    notConfigured: "Custom CSS and JS path not configured. " +
        'Please set "vscode_custom_css_silent.imports" in your user settings.',
    reloadAfterVersionUpgrade: "Detected reloading CSS / JS after VSCode is upgraded. " + "Performing application only.",
    unableToLocateVsCodeInstallationPath: "Unable to locate the installation path of VSCode. This extension may not function correctly.",
    cannotLoad: url => `Cannot load '${url}'. Skipping.`
};
//# sourceMappingURL=messages.js.map