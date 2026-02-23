import { Plugin, WorkspaceLeaf, TFile, parseYaml } from 'obsidian';
import { MyCalcView, VIEW_TYPE_OCALC, t } from './MyCalcView';
import * as Papa from 'papaparse';
import * as math from 'mathjs';

export default class MyCalcPlugin extends Plugin {
	async onload() {
		this.registerView(
			VIEW_TYPE_OCALC,
			(leaf: WorkspaceLeaf) => new MyCalcView(leaf)
		);
		// ★修正: 拡張子を .ocalc に変更
		this.registerExtensions(['ocalc'], VIEW_TYPE_OCALC);

		this.addCommand({
			id: 'create-ocalc-file',
			// ★言語設定に応じたメニュー名
			name: t('new_col_name') === "新しい列名" ? "新しい計算表 (.ocalc) を作成" : "Create new calc table (.ocalc)",
			callback: async () => {
				await this.createNewMyCalcFile();
			}
		});

		// ★修正: コードブロックの識別子を ocalc に変更
		this.registerMarkdownCodeBlockProcessor('ocalc', async (source, el, ctx) => {
			const fileName = source.trim();
			if (!fileName) return;

			const file = this.app.metadataCache.getFirstLinkpathDest(fileName, ctx.sourcePath);

			if (file instanceof TFile && file.extension === 'ocalc') {
				const data = await this.app.vault.cachedRead(file);
				this.renderEmbed(el, data, file.basename);
			} else {
				const errorBox = el.createDiv();
				errorBox.style.color = "var(--text-error)";
				errorBox.style.border = "1px solid var(--background-modifier-error)";
				errorBox.style.padding = "8px";
				errorBox.style.borderRadius = "4px";
				errorBox.innerText = `⚠️ File not found / ファイルが見つかりません: ${fileName}`;
			}
		});
	}

	async createNewMyCalcFile() {
		let fileName = 'Untitled.ocalc';
		let fileNumber = 1;
		while (this.app.vault.getAbstractFileByPath(fileName)) {
			fileName = `Untitled ${fileNumber}.ocalc`;
			fileNumber++;
		}

		const initialData = `---
formulas: {}
totals:
  showTotalRow: true
  targetColumns: []
---
Column1
`;
		try {
			const file = await this.app.vault.create(fileName, initialData);
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);
		} catch (e) {
			console.error("Error creating file", e);
		}
	}

	renderEmbed(container: HTMLElement, rawData: string, titleStr: string) {
		let yamlStr = ""; let csvStr = rawData; let frontmatter: any = {};
		if (rawData.startsWith("---\n")) {
			const endIdx = rawData.indexOf("\n---\n", 4);
			if (endIdx !== -1) {
				yamlStr = rawData.substring(4, endIdx);
				csvStr = rawData.substring(endIdx + 5).replace(/^[\r\n]+/, '');
				try { frontmatter = parseYaml(yamlStr); } catch (e) { }
			}
		}

		const parsedCsv = Papa.parse(csvStr, { header: true, skipEmptyLines: false });
		if (!parsedCsv.meta.fields || parsedCsv.meta.fields.length === 0) parsedCsv.meta.fields = ["Column1"];
		if (!parsedCsv.data || parsedCsv.data.length === 0) {
			const emptyRow: any = {}; parsedCsv.meta.fields.forEach((f: string) => emptyRow[f] = "");
			parsedCsv.data = [emptyRow];
		}

		const data = parsedCsv.data;
		const fields = parsedCsv.meta.fields;

		const wrapper = container.createDiv();
		wrapper.style.border = "1px solid var(--background-modifier-border)";
		wrapper.style.borderRadius = "8px";
		wrapper.style.padding = "16px";
		wrapper.style.backgroundColor = "var(--background-primary)";
		wrapper.style.overflowX = "auto";
		wrapper.style.margin = "1em 0";

		const title = wrapper.createEl('h4', { text: `📊 ${titleStr}` });
		title.style.marginTop = "0";
		title.style.marginBottom = "12px";
		title.style.color = "var(--text-normal)";

		const table = wrapper.createEl('table');
		table.style.width = "100%"; table.style.borderCollapse = "collapse";

		const thead = table.createEl('thead');
		const trHead = thead.createEl('tr');
		fields.forEach((field: string) => {
			const th = trHead.createEl('th', { text: field });
			th.style.border = "1px solid var(--background-modifier-border)"; th.style.padding = "8px"; th.style.background = "var(--background-secondary)"; th.style.fontWeight = "bold";
			if (frontmatter.formulas && frontmatter.formulas[field]) { th.innerText += " (fx)"; th.style.color = "var(--text-accent)"; }
		});

		const tbody = table.createEl('tbody');
		data.forEach((row: any) => {
			const tr = tbody.createEl('tr');
			fields.forEach((field: string) => {
				const td = tr.createEl('td', { text: String(row[field] || "") });
				td.style.border = "1px solid var(--background-modifier-border)"; td.style.padding = "8px";
				if (frontmatter.formulas && frontmatter.formulas[field]) { td.style.background = "var(--background-primary-alt)"; td.style.color = "var(--text-muted)"; }
			});
		});

		if (frontmatter.totals?.showTotalRow !== false) {
			const tfoot = table.createEl('tfoot'); const trFoot = tfoot.createEl('tr');
			trFoot.style.fontWeight = "bold"; trFoot.style.background = "var(--background-secondary)";
			let targetCols = frontmatter.totals?.targetColumns; if (!targetCols) targetCols = [...fields];

			fields.forEach((field: string, index: number) => {
				const tdFoot = trFoot.createEl('td'); tdFoot.style.border = "1px solid var(--background-modifier-border)"; tdFoot.style.padding = "8px";

				// ★修正: i18nの翻訳を利用
				if (index === 0) { tdFoot.innerText = t('total'); }
				else if (targetCols.includes(field)) {
					const resultVal = frontmatter.totals?.results?.[field];
					if (resultVal !== undefined) {
						tdFoot.innerText = String(resultVal);
					} else {
						tdFoot.innerText = "";
					}
				} else { tdFoot.innerText = "-"; tdFoot.style.color = "var(--text-muted)"; tdFoot.style.textAlign = "center"; }
			});
		}
	}
}