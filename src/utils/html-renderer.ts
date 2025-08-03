import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export class HTMLRenderer {
  private templatesPath: string;

  constructor() {
    this.templatesPath = join(__dirname, "../../templates");
  }

  public renderSuccessPage(
    baseUrl: string,
    stateAuthCompleted: boolean = false
  ): string {
    try {
      let template = readFileSync(
        join(this.templatesPath, "success.html"),
        "utf-8"
      );
      template = template.replace(/{{baseUrl}}/g, baseUrl);
      const authCompletedMsg = stateAuthCompleted
        ? '<span style="margin-left:8px; color:#388e3c; font-weight:500;">(Already Authenticated)</span>'
        : "";
      template = template.replace(
        /{{AlreadyAuthenticated}}/g,
        authCompletedMsg
      );
      return template;
    } catch {
      return this.getFallbackSuccessPage(baseUrl);
    }
  }

  public renderErrorPage(title: string, message: string): string {
    try {
      const template = readFileSync(
        join(this.templatesPath, "error.html"),
        "utf-8"
      );
      return template
        .replace(/{{title}}/g, title)
        .replace(/{{message}}/g, message);
    } catch {
      return this.getFallbackErrorPage(title, message);
    }
  }

  private getFallbackSuccessPage(baseUrl: string): string {
    return `<!DOCTYPE html>
<html><head><title>Authentication Successful</title></head>
<body><h1>Success!</h1>
<p>Authenticated with ${baseUrl}</p>
<p>You can close this window.</p>
</body></html>`;
  }

  private getFallbackErrorPage(title: string, message: string): string {
    return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><h1>${title}</h1>
<p>${message}</p>
<p>Please close this window and try again.</p>
</body></html>`;
  }
}
