/**
 * Copyright (C) 2023 Zuoqiu Yingyi
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import siyuan from "siyuan";
import type { ISiyuanGlobal } from "@workspace/types/siyuan";

import {
    Client,
    type types,
} from "@siyuan-community/siyuan-sdk";

import Settings from "./components/Settings.svelte";

import {
    FLAG_MOBILE,
} from "@workspace/utils/env/front-end";
import { Logger } from "@workspace/utils/logger";
import { mergeIgnoreArray } from "@workspace/utils/misc/merge";
import { getEditors } from "@workspace/utils/siyuan/model";
import { deshake } from "@workspace/utils/misc/deshake";
import {
    getCurrentBlock,
    getCurrentProtyleWysiwyg,
} from "@workspace/utils/siyuan/dom";

import type {
    IClickEditorContentEvent,
    ILoadedProtyleEvent,
    IDestroyProtyleEvent,
} from "@workspace/types/siyuan/events";
import type { IProtyle } from "siyuan/types/protyle";

import { DEFAULT_CONFIG } from "./configs/default";
import type { I18N } from "./utils/i18n";
import type { IConfig } from "./types/config";

declare var globalThis: ISiyuanGlobal;

export default class TypewriterPlugin extends siyuan.Plugin {
    static readonly GLOBAL_CONFIG_NAME = "global-config";

    declare public readonly i18n: I18N;

    public readonly siyuan = siyuan;
    public readonly logger: InstanceType<typeof Logger>;
    public readonly client: InstanceType<typeof Client>;

    protected readonly SETTINGS_DIALOG_ID: string;
    protected readonly protyles = new WeakSet<IProtyle>();

    protected config: IConfig = DEFAULT_CONFIG;
    protected scrollIntoView!: ReturnType<typeof deshake<(element: HTMLElement) => void>>;
    protected currentElement?: Element; // 当前元素

    constructor(options: any) {
        super(options);

        this.logger = new Logger(this.name);
        this.client = new Client(undefined, "fetch");

        this.SETTINGS_DIALOG_ID = `${this.name}-settings-dialog`;
        this.updateScrollFunction();
    }

    onload(): void {
        // this.logger.debug(this);

        /* 注册图标 */
        this.addIcons([
        ].join(""));

        this.loadData(TypewriterPlugin.GLOBAL_CONFIG_NAME)
            .then(config => {
                this.config = mergeIgnoreArray(DEFAULT_CONFIG, config || {}) as IConfig;
                this.updateScrollFunction();
            })
            .catch(error => this.logger.error(error))
            .finally(() => {
                this.activate(this.config.typewriter.enable);
            });
    }

    onLayoutReady(): void {
    }

    onunload(): void {
        this.activate(false);
    }

    openSetting(): void {
        const that = this;
        const dialog = new siyuan.Dialog({
            title: `${this.i18n.displayName} <code class="fn__code">${this.name}</code>`,
            content: `<div id="${that.SETTINGS_DIALOG_ID}" class="fn__flex-column" />`,
            width: FLAG_MOBILE ? "92vw" : "720px",
            height: FLAG_MOBILE ? undefined : "640px",
        });
        const target = dialog.element.querySelector(`#${that.SETTINGS_DIALOG_ID}`);
        if (target) {
            const settings = new Settings({
                target,
                props: {
                    config: this.config,
                    plugin: this,
                },
            });
        }
    }

    /* 重置插件配置 */
    public async resetConfig(): Promise<void> {
        return this.updateConfig(mergeIgnoreArray(DEFAULT_CONFIG) as IConfig);
    }

    /* 更新插件配置 */
    public async updateConfig(config?: IConfig): Promise<void> {
        if (config && config !== this.config) {
            this.config = config;
        }

        this.activate(this.config.typewriter.enable);
        this.updateScrollFunction();

        return this.saveData(TypewriterPlugin.GLOBAL_CONFIG_NAME, this.config);
    }

    /**
     * 切换监听器
     * @param protyle 编辑器
     * @param enable 是否启用打字机模式
     */
    protected toggleEventListener(
        protyle: IProtyle,
        enable: boolean,
    ): void {
        const listener = [
            "keyup",
            this.editorEventListener,
            {
                capture: true,
            },
        ] as Parameters<HTMLElement["addEventListener"]>;

        switch (true) {
            case enable && !this.protyles.has(protyle): // 未加入监听的编辑器
                this.protyles.add(protyle);
                protyle.wysiwyg?.element?.addEventListener(...listener);
                break;

            case !enable && this.protyles.has(protyle): // 已加入监听的编辑器
                this.protyles.delete(protyle);
                protyle.wysiwyg?.element?.removeEventListener(...listener);
                break;
        }
    }

    /**
     * 激活或禁用打字机模式
     * @param enable 是否启用打字机模式
     */
    protected activate(enable: boolean): void {
        const editors = getEditors(); // 获取所有编辑器
        for (const editor of editors) {
            const protyle = editor?.protyle;
            if (protyle) {
                this.toggleEventListener(protyle, enable);
            }
        }

        if (enable) {
            this.eventBus.on("loaded-protyle", this.loadedProtyleEventListener);
            this.eventBus.on("destroy-protyle", this.destroyProtyleEventListener);
            this.eventBus.on("click-editorcontent", this.clickEditorContentEventListener);
        }
        else {
            this.eventBus.off("loaded-protyle", this.loadedProtyleEventListener);
            this.eventBus.off("destroy-protyle", this.destroyProtyleEventListener);
            this.eventBus.off("click-editorcontent", this.clickEditorContentEventListener);
        }
    }

    /**
     * 更新滚动函数
     * @param timeout 延时 (ms)
     */
    protected updateScrollFunction(timeout: number = this.config.typewriter.timeout): void {
        this.scrollIntoView = deshake(
            (element: HTMLElement) => {
                this.logger.debug(element);
                element.scrollIntoView({
                    behavior: "smooth",
                    inline: "center",
                    block: "center",
                });
            },
            timeout,
        );
    }

    /* 编辑器加载事件 */
    protected readonly loadedProtyleEventListener = (e: ILoadedProtyleEvent) => {
        // this.logger.debug(e);

        /* 若开启打字机模式, 添加编辑事件监听器 */
        if (this.config.typewriter.enable) {
            const protyle = e.detail;
            this.toggleEventListener(protyle, true);
        }
    };

    /* 编辑器关闭事件 */
    protected readonly destroyProtyleEventListener = (e: IDestroyProtyleEvent) => {
        // this.logger.debug(e);

        /* 移除编辑事件监听器 */
        const protyle = e.detail.protyle;
        this.toggleEventListener(protyle, false);
    };

    /* 编辑器点击事件 */
    protected readonly clickEditorContentEventListener = (e: IClickEditorContentEvent) => {
        // this.logger.debug(e);

        /* 若开启打字机模式, 派发编辑事件 */
        if (this.config.typewriter.enable) {
            const event = e.detail.event;
            this.editorEventListener(event);
        }
    };

    /* 编辑事件监听 */
    protected readonly editorEventListener = (e: Event) => {
        // this.logger.debug(e);

        if (this.config.typewriter.enable) { // 已开启打字机模式
            const block = getCurrentBlock(); // 当前光标所在块
            if (block) {
                let element = block;

                switch (block.dataset.type) {
                    case "NodeCodeBlock":
                        if (this.config.typewriter.code.row) { // 定位到行

                        }
                        break;
                    case "NodeTable":
                        if (this.config.typewriter.table.row) { // 定位到行
                            let focus = globalThis.getSelection()?.focusNode;
                            while (true) {
                                if (!focus) { // 元素不存在
                                    break;
                                }
                                else { // 元素存在
                                    if (focus instanceof HTMLElement) { // 元素为 HTML 元素
                                        if (focus.localName === "td" || focus.localName === "th") { // 元素为表格单元格
                                            break;
                                        }
                                    }
                                }
                                focus = focus.parentElement;
                            }
                            element = focus ?? block;
                        }
                        break;
                    default:
                        break;
                }

                if (this.currentElement === element) { // 当前元素未改变
                    return;
                }
                else { // 更新当前元素并滚动
                    this.currentElement = element;
                    this.scrollIntoView(element);
                }
            }

            // const page = getCurrentProtyleWysiwyg()?.parentElement; // 当前页面
            // if (page?.classList.contains("protyle-content")) {

            //     let block_height = block.clientHeight; // 当前块的高度
            //     let block_bottom = block.getBoundingClientRect().bottom; // 当前块的底部
            //     let page_height = page.clientHeight; // 当前页面的高度
            //     let page_bottom = page.getBoundingClientRect().bottom; // 当前页面的底部
            // }
        }
    };
};
