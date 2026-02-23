import { TextFileView, WorkspaceLeaf, parseYaml, stringifyYaml, Menu, Modal, App, Setting } from 'obsidian';
import * as Papa from 'papaparse';
import * as math from 'mathjs';

export const VIEW_TYPE_OCALC = 'ocalc-view';

// ==========================================
// i18n (多言語対応) の設定
// ==========================================
export const locales = {
    en: {
        rename_col: "Rename Column",
        new_col_name: "New Column Name",
        edit_formula: "Edit / Clear Formula",
        set_formula: "Set Formula",
        formula_desc: "e.g., {Price} * {Qty} (Save empty to clear)",
        add_col_left: "Add Column Left",
        add_col_right: "Add Column Right",
        del_col: "Delete Column",
        add_row_above: "Add Row Above",
        add_row_below: "Add Row Below",
        del_row: "Delete Row",
        add_row_bottom: "+ Add Row",
        toggle_total_on: "Σ Show Total",
        toggle_total_off: "Σ Hide Total",
        total: "Total",
        save: "Save",
        change: "Change"
    },
    ja: {
        rename_col: "列名を変更",
        new_col_name: "新しい列名",
        edit_formula: "計算式を編集 / 解除",
        set_formula: "計算式を設定",
        formula_desc: "例: {単価} * {数量} （※空欄にして保存すると解除します）",
        add_col_left: "左に列を追加",
        add_col_right: "右に列を追加",
        del_col: "列を削除",
        add_row_above: "この上に行を追加",
        add_row_below: "この下に行を追加",
        del_row: "行を削除",
        add_row_bottom: "+ 最終行に追加",
        toggle_total_on: "Σ 合計を表示",
        toggle_total_off: "Σ 合計を隠す",
        total: "合計",
        save: "保存",
        change: "変更"
    }
};

export function t(key: keyof typeof locales.en): string {
    const lang = window.localStorage.getItem('language');
    return (lang === 'ja' ? locales.ja[key] : locales.en[key]) || locales.en[key];
}

// ==========================================
// モーダルクラス
// ==========================================
class RenameModal extends Modal {
    oldName: string; newName: string; onSubmit: (newName: string) => void;
    constructor(app: App, oldName: string, onSubmit: (newName: string) => void) { super(app); this.oldName = oldName; this.newName = oldName; this.onSubmit = onSubmit; }
    onOpen() {
        const { contentEl } = this; contentEl.createEl('h2', { text: t('rename_col') });
        new Setting(contentEl).setName(t('new_col_name')).addText(text => text.setValue(this.oldName).onChange(value => { this.newName = value; }).inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.close(); this.onSubmit(this.newName); } }));
        new Setting(contentEl).addButton(btn => btn.setButtonText(t('change')).setCta().onClick(() => { this.close(); this.onSubmit(this.newName); }));
    }
    onClose() { this.contentEl.empty(); }
}

class FormulaModal extends Modal {
    colName: string; formula: string; onSubmit: (formula: string) => void;
    constructor(app: App, colName: string, initialFormula: string, onSubmit: (formula: string) => void) { super(app); this.colName = colName; this.formula = initialFormula; this.onSubmit = onSubmit; }
    onOpen() {
        const { contentEl } = this; contentEl.createEl('h2', { text: `[${this.colName}] Formula` }); contentEl.createEl('p', { text: t('formula_desc'), cls: 'setting-item-description' });
        new Setting(contentEl).setName('Formula').addText(text => text.setValue(this.formula).onChange(value => { this.formula = value; }).inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.close(); this.onSubmit(this.formula); } }));
        new Setting(contentEl).addButton(btn => btn.setButtonText(t('save')).setCta().onClick(() => { this.close(); this.onSubmit(this.formula); }));
    }
    onClose() { this.contentEl.empty(); }
}

// ==========================================
// メインビュークラス
// ==========================================
export class MyCalcView extends TextFileView {
    data: string = "";
    private focusTarget: { row: number, col: string } | null = null;
    private draggedColIndex: number | null = null;
    private draggedRowIndex: number | null = null;

    // ★新規: ソース表示モードのフラグ
    private isSourceMode: boolean = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);

        // ★新規: タブの右上に「ソース表示/テーブル表示」の切り替えボタンを追加
        this.addAction('code', 'Toggle Source / Table View', () => {
            this.isSourceMode = !this.isSourceMode;
            this.renderUI();
        });
    }

    getViewType(): string { return VIEW_TYPE_OCALC; }
    getDisplayText(): string { return this.file ? this.file.basename : 'OCalc'; }
    getViewData(): string { return this.data; }
    setViewData(data: string, clear: boolean): void { this.data = data; this.renderUI(); }
    clear(): void { this.data = ""; this.renderUI(); }

    parseData(raw: string) {
        let yamlStr = ""; let csvStr = raw; let frontmatter: any = {};
        if (raw.startsWith("---\n")) {
            const endIdx = raw.indexOf("\n---\n", 4);
            if (endIdx !== -1) {
                yamlStr = raw.substring(4, endIdx);
                csvStr = raw.substring(endIdx + 5).replace(/^[\r\n]+/, '');
                try { frontmatter = parseYaml(yamlStr); } catch (e) { }
            }
        }

        const parsedCsv = Papa.parse(csvStr, { header: true, skipEmptyLines: false });
        if (!parsedCsv.meta.fields || parsedCsv.meta.fields.length === 0) { parsedCsv.meta.fields = ["Column1"]; }
        if (!parsedCsv.data || parsedCsv.data.length === 0) {
            const emptyRow: any = {}; parsedCsv.meta.fields.forEach((f: string) => emptyRow[f] = "");
            parsedCsv.data = [emptyRow];
        }
        return { frontmatter, data: parsedCsv.data, meta: parsedCsv.meta };
    }

    evaluateFormula(formula: string, row: any): number {
        let parsedFormula = formula; const scope: any = {}; let varCounter = 0;
        const regex = /\{([^}]+)\}/g;
        parsedFormula = parsedFormula.replace(regex, (match, colName) => {
            const varName = `var${varCounter++}`; const val = parseFloat(row[colName]); scope[varName] = isNaN(val) ? 0 : val; return varName;
        });
        try {
            const rawValue = math.evaluate(parsedFormula, scope);
            return Number(math.format(rawValue, { precision: 14 }));
        } catch (e) { return 0; }
    }

    recalculateAll(frontmatter: any, data: any[]) {
        if (!frontmatter.formulas) return;
        data.forEach(row => {
            for (const [targetCol, formula] of Object.entries(frontmatter.formulas)) {
                if (typeof formula === 'string') { row[targetCol] = this.evaluateFormula(formula, row); }
            }
        });
    }

    saveData(frontmatter: any, data: any[], meta: Papa.ParseMeta) {
        this.recalculateAll(frontmatter, data);

        if (frontmatter.totals && frontmatter.totals.showTotalRow !== false) {
            frontmatter.totals.results = {};
            let targetCols = frontmatter.totals.targetColumns;
            if (!targetCols) targetCols = [...(meta.fields || [])];

            meta.fields?.forEach((field: string) => {
                if (targetCols.includes(field)) {
                    let sum = 0; let hasNumeric = false;
                    data.forEach((row: any) => {
                        const val = parseFloat(row[field]);
                        if (!isNaN(val)) { sum += val; hasNumeric = true; }
                    });
                    if (hasNumeric) {
                        frontmatter.totals.results[field] = Number(math.format(sum, { precision: 14 }));
                    }
                }
            });
        }

        const yamlStr = stringifyYaml(frontmatter);
        const csvStr = Papa.unparse({ fields: meta.fields, data: data });
        this.data = `---\n${yamlStr}---\n${csvStr}`;
        this.requestSave();
    }

    escapeRegExp(string: string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    renameColumn(oldName: string, newName: string, parsed: any) {
        if (!newName || oldName === newName || parsed.meta.fields?.includes(newName)) return;
        const colIndex = parsed.meta.fields.indexOf(oldName);
        if (colIndex > -1) parsed.meta.fields[colIndex] = newName;
        parsed.data.forEach((row: any) => { row[newName] = row[oldName]; delete row[oldName]; });

        if (parsed.frontmatter?.formulas) {
            if (parsed.frontmatter.formulas[oldName]) { parsed.frontmatter.formulas[newName] = parsed.frontmatter.formulas[oldName]; delete parsed.frontmatter.formulas[oldName]; }
            const regex = new RegExp(`\\{${this.escapeRegExp(oldName)}\\}`, 'g');
            for (const key in parsed.frontmatter.formulas) { parsed.frontmatter.formulas[key] = parsed.frontmatter.formulas[key].replace(regex, `{${newName}}`); }
        }
        if (parsed.frontmatter?.totals?.targetColumns) {
            const tIndex = parsed.frontmatter.totals.targetColumns.indexOf(oldName);
            if (tIndex > -1) parsed.frontmatter.totals.targetColumns[tIndex] = newName;
        }
        this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
    }

    addColumnAt(targetField: string, position: 'left' | 'right', parsed: any) {
        let baseName = "NewCol"; let newName = baseName; let counter = 1;
        while (parsed.meta.fields?.includes(newName)) { newName = `${baseName}${counter++}`; }
        const colIndex = parsed.meta.fields.indexOf(targetField);
        const insertIndex = position === 'left' ? colIndex : colIndex + 1;
        parsed.meta.fields.splice(insertIndex, 0, newName);
        parsed.data.forEach((row: any) => row[newName] = "");
        this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
    }

    deleteColumn(field: string, parsed: any) {
        const colIndex = parsed.meta.fields.indexOf(field);
        if (colIndex > -1) parsed.meta.fields.splice(colIndex, 1);
        parsed.data.forEach((row: any) => { delete row[field]; });
        if (parsed.frontmatter?.formulas && parsed.frontmatter.formulas[field]) { delete parsed.frontmatter.formulas[field]; }
        if (parsed.frontmatter?.totals?.targetColumns) {
            const tIndex = parsed.frontmatter.totals.targetColumns.indexOf(field);
            if (tIndex > -1) parsed.frontmatter.totals.targetColumns.splice(tIndex, 1);
        }
        this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
    }

    setFormula(colName: string, formula: string, parsed: any) {
        if (!parsed.frontmatter.formulas) parsed.frontmatter.formulas = {};
        if (formula.trim() === "") { delete parsed.frontmatter.formulas[colName]; } else { parsed.frontmatter.formulas[colName] = formula.trim(); }
        this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
    }

    toggleTotalColumn(colName: string, parsed: any) {
        if (!parsed.frontmatter.totals) parsed.frontmatter.totals = { showTotalRow: true, targetColumns: [] };
        if (!parsed.frontmatter.totals.targetColumns) parsed.frontmatter.totals.targetColumns = [...(parsed.meta.fields || [])];
        const targets = parsed.frontmatter.totals.targetColumns;
        const index = targets.indexOf(colName);
        if (index > -1) { targets.splice(index, 1); } else { targets.push(colName); }
        this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
    }

    renderUI() {
        const container = this.contentEl; container.empty();

        // ★新規: ソースビューモードの場合、テキストをそのまま表示して終了
        if (this.isSourceMode) {
            const pre = container.createEl('pre');
            pre.style.userSelect = "text";
            pre.style.padding = "16px";
            pre.style.background = "var(--background-secondary)";
            pre.style.borderRadius = "8px";
            pre.style.whiteSpace = "pre-wrap";
            pre.style.fontFamily = "var(--font-monospace)";
            pre.createEl('code', { text: this.data });
            return;
        }

        const title = container.createEl('h2', { text: `📊 ${this.getDisplayText()}` }); title.style.marginBottom = "20px";
        if (!this.data) return;
        const parsed = this.parseData(this.data);

        const toolbar = container.createDiv(); toolbar.style.display = "flex"; toolbar.style.gap = "10px"; toolbar.style.marginBottom = "10px";
        const addRowBtn = toolbar.createEl('button', { text: t('add_row_bottom') });

        // ★新規: 合計行のON/OFFトグルボタンを追加
        const isTotalShown = parsed.frontmatter?.totals?.showTotalRow !== false;
        const toggleTotalBtn = toolbar.createEl('button', { text: isTotalShown ? t('toggle_total_off') : t('toggle_total_on') });
        toggleTotalBtn.onclick = () => {
            if (!parsed.frontmatter.totals) parsed.frontmatter.totals = {};
            parsed.frontmatter.totals.showTotalRow = !isTotalShown;
            this.saveData(parsed.frontmatter, parsed.data, parsed.meta);
            this.renderUI();
        };

        const tableContainer = container.createDiv(); tableContainer.style.overflowX = "auto";
        const table = tableContainer.createEl('table'); table.style.width = "100%"; table.style.borderCollapse = "collapse";

        const thead = table.createEl('thead'); const trHead = thead.createEl('tr');
        const thHandle = trHead.createEl('th', { text: "#" });
        thHandle.style.border = "1px solid var(--background-modifier-border)"; thHandle.style.background = "var(--background-secondary)"; thHandle.style.width = "40px";

        parsed.meta.fields?.forEach((field: string, colIndex: number) => {
            const th = trHead.createEl('th', { text: field });
            th.style.border = "1px solid var(--background-modifier-border)"; th.style.padding = "8px"; th.style.background = "var(--background-secondary)"; th.style.fontWeight = "bold";
            th.style.cursor = "grab"; th.title = "Drag to move / Right-click for menu";

            th.setAttribute('draggable', 'true');
            th.addEventListener('dragstart', (e) => { this.draggedColIndex = colIndex; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; th.style.opacity = '0.5'; });
            th.addEventListener('dragend', () => { th.style.opacity = '1'; });
            th.addEventListener('dragover', (e) => { if (this.draggedColIndex !== null && this.draggedColIndex !== colIndex) { e.preventDefault(); th.style.borderLeft = "3px solid var(--interactive-accent)"; } });
            th.addEventListener('dragleave', () => { th.style.borderLeft = "1px solid var(--background-modifier-border)"; });
            th.addEventListener('drop', (e) => {
                e.preventDefault();
                if (this.draggedColIndex !== null && this.draggedColIndex !== colIndex) {
                    const fields = parsed.meta.fields; const movedField = fields.splice(this.draggedColIndex, 1)[0]; fields.splice(colIndex, 0, movedField);
                    this.draggedColIndex = null; this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
                }
            });

            th.addEventListener('contextmenu', (e) => {
                e.preventDefault(); const menu = new Menu();
                menu.addItem((item) => { item.setTitle(t('rename_col')).setIcon('pencil').onClick(() => { new RenameModal(this.app, field, (newName) => { this.renameColumn(field, newName, parsed); }).open(); }); });
                menu.addItem((item) => { const currentFormula = parsed.frontmatter?.formulas?.[field] || ""; item.setTitle(currentFormula ? t('edit_formula') : t('set_formula')).setIcon('calculator').onClick(() => { new FormulaModal(this.app, field, currentFormula, (newFormula) => { this.setFormula(field, newFormula, parsed); }).open(); }); });
                menu.addSeparator();
                menu.addItem((item) => { item.setTitle(t('add_col_left')).setIcon('arrow-left').onClick(() => { this.addColumnAt(field, 'left', parsed); }); });
                menu.addItem((item) => { item.setTitle(t('add_col_right')).setIcon('arrow-right').onClick(() => { this.addColumnAt(field, 'right', parsed); }); });
                menu.addSeparator();
                menu.addItem((item) => { item.setTitle(t('del_col')).setIcon('trash').onClick(() => { this.deleteColumn(field, parsed); }); });
                menu.showAtMouseEvent(e);
            });
            if (parsed.frontmatter?.formulas && parsed.frontmatter.formulas[field]) { th.innerText += " (fx)"; th.style.color = "var(--text-accent)"; }
        });

        const tbody = table.createEl('tbody');
        parsed.data.forEach((row: any, rowIndex: number) => {
            const tr = tbody.createEl('tr');
            const tdHandle = tr.createEl('td', { text: String(rowIndex + 1) });
            tdHandle.style.border = "1px solid var(--background-modifier-border)"; tdHandle.style.background = "var(--background-secondary)"; tdHandle.style.textAlign = "center"; tdHandle.style.color = "var(--text-muted)";
            tdHandle.style.cursor = "grab";

            tdHandle.setAttribute('draggable', 'true');
            tdHandle.addEventListener('dragstart', (e) => { this.draggedRowIndex = rowIndex; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
            tr.addEventListener('dragover', (e) => { if (this.draggedRowIndex !== null && this.draggedRowIndex !== rowIndex) { e.preventDefault(); tr.style.borderTop = "3px solid var(--interactive-accent)"; } });
            tr.addEventListener('dragleave', () => { tr.style.borderTop = ""; });
            tr.addEventListener('drop', (e) => {
                e.preventDefault(); tr.style.borderTop = "";
                if (this.draggedRowIndex !== null && this.draggedRowIndex !== rowIndex) {
                    const movedRow = parsed.data.splice(this.draggedRowIndex, 1)[0]; parsed.data.splice(rowIndex, 0, movedRow);
                    this.draggedRowIndex = null; this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
                }
            });

            tdHandle.addEventListener('contextmenu', (e) => {
                e.preventDefault(); const menu = new Menu();
                menu.addItem((item) => { item.setTitle(t('add_row_above')).setIcon('arrow-up').onClick(() => { const newRow: any = {}; parsed.meta.fields?.forEach((f: string) => newRow[f] = ""); parsed.data.splice(rowIndex, 0, newRow); this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI(); }); });
                menu.addItem((item) => { item.setTitle(t('add_row_below')).setIcon('arrow-down').onClick(() => { const newRow: any = {}; parsed.meta.fields?.forEach((f: string) => newRow[f] = ""); parsed.data.splice(rowIndex + 1, 0, newRow); this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI(); }); });
                menu.addSeparator();
                menu.addItem((item) => { item.setTitle(t('del_row')).setIcon('trash').onClick(() => { parsed.data.splice(rowIndex, 1); this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI(); }); });
                menu.showAtMouseEvent(e);
            });

            parsed.meta.fields?.forEach((field: string) => {
                const isFormulaCol = parsed.frontmatter?.formulas && parsed.frontmatter.formulas[field];
                const td = tr.createEl('td', { text: String(row[field] || "") });
                td.style.border = "1px solid var(--background-modifier-border)"; td.style.padding = "8px"; td.setAttribute('data-row', String(rowIndex)); td.setAttribute('data-col', field);

                if (isFormulaCol) {
                    td.style.background = "var(--background-primary-alt)"; td.style.color = "var(--text-muted)";
                } else {
                    td.style.cursor = "text"; td.setAttribute('contenteditable', 'true');
                    td.onblur = (e) => { const newVal = (e.target as HTMLElement).innerText.trim(); if (row[field] !== newVal) { row[field] = newVal; this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI(); } };
                    td.onkeydown = (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault(); row[field] = (e.target as HTMLElement).innerText.trim(); let nextRowIndex = rowIndex + 1;
                            if (rowIndex === parsed.data.length - 1) { const newRow: any = {}; parsed.meta.fields?.forEach((f: string) => newRow[f] = ""); parsed.data.push(newRow); }
                            this.focusTarget = { row: nextRowIndex, col: field }; this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI();
                        }
                    };
                }
            });
        });

        if (isTotalShown) {
            const tfoot = table.createEl('tfoot'); const trFoot = tfoot.createEl('tr');
            trFoot.style.fontWeight = "bold"; trFoot.style.background = "var(--background-secondary)";

            const tdFootHandle = trFoot.createEl('td', { text: "Σ" });
            tdFootHandle.style.border = "1px solid var(--background-modifier-border)";
            tdFootHandle.style.textAlign = "center";

            let targetCols = parsed.frontmatter?.totals?.targetColumns;
            if (!targetCols) targetCols = [...(parsed.meta.fields || [])];

            parsed.meta.fields?.forEach((field: string) => {
                const tdFoot = trFoot.createEl('td');
                tdFoot.style.border = "1px solid var(--background-modifier-border)";
                tdFoot.style.padding = "8px";
                tdFoot.style.cursor = "pointer";
                tdFoot.onclick = () => { this.toggleTotalColumn(field, parsed); };

                if (targetCols.includes(field)) {
                    const resultVal = parsed.frontmatter?.totals?.results?.[field];
                    if (resultVal !== undefined) {
                        tdFoot.innerText = String(resultVal);
                    } else {
                        tdFoot.innerText = "";
                    }
                } else {
                    tdFoot.innerText = "-";
                    tdFoot.style.color = "var(--text-muted)";
                    tdFoot.style.textAlign = "center";
                }
            });
        }

        addRowBtn.onclick = () => { const newRow: any = {}; parsed.meta.fields?.forEach((f: string) => newRow[f] = ""); parsed.data.push(newRow); this.saveData(parsed.frontmatter, parsed.data, parsed.meta); this.renderUI(); };

        if (this.focusTarget) {
            setTimeout(() => {
                if (!this.focusTarget) return; const targetTd = this.contentEl.querySelector(`td[data-row="${this.focusTarget.row}"][data-col="${this.focusTarget.col}"]`) as HTMLElement;
                if (targetTd) { targetTd.focus(); const range = document.createRange(); const sel = window.getSelection(); range.selectNodeContents(targetTd); range.collapse(false); sel?.removeAllRanges(); sel?.addRange(range); }
                this.focusTarget = null;
            }, 10);
        }
    }
}