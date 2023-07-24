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

import type siyuan from "siyuan";
import type MonacoEditorPlugin from "@/index";
import { FileTreeNodeType, type IFileTreeNodeStores } from "@workspace/components/siyuan/tree/file";
import { get } from "svelte/store";
import { HandlerType } from "@/facades/facade";
import { FLAG_ELECTRON } from "@workspace/utils/env/front-end";
import { copyText } from "@workspace/utils/misc/copy";
import { isStaticWebFileServicePath, workspacePath2StaticPathname } from "@workspace/utils/siyuan/url";
import { ExplorerIcon } from "./icon";
import type { Explorer } from ".";
import { extname, join } from "@workspace/utils/path/browserify";
import {
    fn__code,
    ft__error,
    ft__primary,
} from "@workspace/utils/siyuan/text/span";
import { prompt } from "@workspace/components/siyuan/dialog/prompt";
import { isValidName } from "@workspace/utils/file/filename";

/* 菜单项类型 */
export enum MenuItemType {
    Action, // 菜单项
    Submenu, // 子菜单
    Separator, // 分割线
}

/* 菜单项适用节点类型 */
export interface IMenuBase {
    type: MenuItemType; // 菜单项类型

    root: boolean; // 适用根节点
    folder: boolean; // 适用文件夹节点
    file: boolean; // 适用文件节点
}

/* 常规菜单项 */
export interface IMenuAction extends IMenuBase {
    type: MenuItemType.Action,
    options: siyuan.IMenuItemOption,
}

/* 多级菜单项 */
export interface IMenuSubmenu extends IMenuBase {
    type: MenuItemType.Submenu,
    options: siyuan.IMenuItemOption,
    submenu: IMenuItem[],
}

/* 菜单分割线 */
export interface IMenuSeparator extends IMenuBase {
    type: MenuItemType.Separator,
    index?: number,
}

/* 菜单项 */
export type IMenuItem = IMenuAction | IMenuSubmenu | IMenuSeparator;


export class ExplorerContextMenu {
    /* 按类型过滤节点 */
    protected static filter(
        items: IMenuItem[],
        type: FileTreeNodeType,
    ): IMenuItem[] {
        /* 按节点类型过滤 */
        items = (() => {
            switch (type) {
                case FileTreeNodeType.Root:
                    return items.filter(item => item.root);
                case FileTreeNodeType.Folder:
                    return items.filter(item => item.folder);
                case FileTreeNodeType.File:
                    return items.filter(item => item.file);
            }
        })();
        if (items.length === 0) return items;

        /* 过滤下级菜单 */
        items = items.filter(item => {
            if (item.type === MenuItemType.Submenu) {
                item.submenu = ExplorerContextMenu.filter(item.submenu, type);
                return item.submenu.length > 0
                    && item.submenu.some(item => item.type !== MenuItemType.Separator);
            }
            else return true;
        });
        if (items.length === 0) return items;

        /* 清理首尾两端的分割线 */
        items = items.slice(
            items.findIndex(item => item.type !== MenuItemType.Separator),
            items.findLastIndex(item => item.type !== MenuItemType.Separator) + 1,
        );
        if (items.length === 0) return items;

        /* 清理连续的分割线 */
        items = items.filter((item, index, items) => {
            if (item.type !== MenuItemType.Separator) return true;
            else return items[index - 1]?.type !== MenuItemType.Separator;
        });

        return items;
    };

    /* 构造含有下级菜单的菜单项 */
    public static makeSubmenuItem(item: IMenuSubmenu): siyuan.IMenuItemOption {
        item.options.submenu = item.submenu.map(item => {
            switch (item.type) {
                case MenuItemType.Action:
                    return item.options;
                case MenuItemType.Submenu:
                    return ExplorerContextMenu.makeSubmenuItem(item);
                case MenuItemType.Separator:
                    return { type: "separator" };
            }
        });
        return item.options;
    }

    protected readonly i18n: MonacoEditorPlugin["i18n"];

    constructor(
        protected readonly plugin: InstanceType<typeof MonacoEditorPlugin>, // 插件对象
        protected readonly explorer: InstanceType<typeof Explorer>, // 插件对象
    ) {
        this.i18n = this.plugin.i18n;
    }

    /* 构造菜单 */
    public makeMenu(node: IFileTreeNodeStores): InstanceType<typeof siyuan.Menu> {
        const menu = new this.plugin.siyuan.Menu();
        const items = ExplorerContextMenu.filter(this.makeMenuItems(node), get(node.type));
        items.forEach(item => {
            switch (item.type) {
                case MenuItemType.Action:
                    menu.addItem(item.options);
                    break;
                case MenuItemType.Submenu:
                    menu.addItem(ExplorerContextMenu.makeSubmenuItem(item));
                    break;
                case MenuItemType.Separator:
                    menu.addSeparator(item.index);
                    break;
            }
        });
        return menu;
    }

    /* 构造菜单项列表 */
    public makeMenuItems(node: IFileTreeNodeStores): IMenuItem[] {
        const type = get(node.type);
        const name = get(node.name);
        const path = get(node.path);
        const relative = get(node.relative);
        const children = get(node.children);

        const ext = extname(path); // 文件扩展名
        const sub_names: Set<string> = children // 下级资源名称列表
            ? new Set(children.map(node => node.name))
            : null;
        const accessible = isStaticWebFileServicePath(relative); // 是否位于静态 web 文件目录下

        const items: IMenuItem[] = [];

        /* 新建 */
        items.push({
            type: MenuItemType.Submenu,
            options: {
                icon: "iconAdd",
                label: this.i18n.menu.new.label,
            },
            submenu: [
                /* 新建文件 */
                {
                    type: MenuItemType.Action,
                    options: {
                        icon: "iconFile",
                        label: this.i18n.menu.newFile.label,
                        click: () => {
                            this.create(
                                node,
                                sub_names,
                                relative,
                                false,
                            );
                        },
                    },
                    root: true,
                    folder: true,
                    file: false,
                },
                /* 新建文件夹 */
                {
                    type: MenuItemType.Action,
                    options: {
                        icon: "iconFolder",
                        label: this.i18n.menu.newFolder.label,
                        click: () => {
                            this.create(
                                node,
                                sub_names,
                                relative,
                                true,
                            );
                        },
                    },
                    root: true,
                    folder: true,
                    file: false,
                },
            ],
            root: true,
            folder: true,
            file: false,
        });

        items.push({
            type: MenuItemType.Separator,
            root: true,
            folder: true,
            file: false,
        });

        /* 刷新 */
        items.push({
            type: MenuItemType.Submenu,
            options: {
                icon: "iconRefresh",
                label: this.i18n.menu.refresh.label,
            },
            submenu: [
                /* 刷新目录 */
                {
                    type: MenuItemType.Action,
                    options: {
                        icon: "iconRefresh",
                        label: this.i18n.menu.refreshDirectory.label,
                        click: () => {
                            this.explorer.updateNode(node);
                        },
                    },
                    root: true,
                    folder: true,
                    file: false,
                },
                /* 深度刷新目录 */
                {
                    type: MenuItemType.Action,
                    options: {
                        icon: "iconRefresh",
                        label: this.i18n.menu.refreshDirectoryDeeply.label,
                        click: () => {
                            this.explorer.updateNode(node, true);
                        },
                    },
                    root: true,
                    folder: true,
                    file: false,
                },
            ],
            root: true,
            folder: true,
            file: false,
        });

        items.push({
            type: MenuItemType.Separator,
            root: true,
            folder: true,
            file: false,
        });

        /* 打开文件 */
        items.push({
            type: MenuItemType.Action,
            options: {
                icon: "iconCode",
                label: this.i18n.menu.openFile.label,
                submenu: this.plugin.buildOpenSubmenu(
                    {
                        type: HandlerType.asset,
                        handler: {
                            path: get(node.relative),
                        },
                        breadcrumb: {
                            path: get(node.relative),
                        },
                    },
                    get(node.icon),
                    get(node.text),
                ),
            },
            root: false,
            folder: false,
            file: true,
        });

        if (FLAG_ELECTRON) {
            /**
             * 使用默认程序打开
             * REF: https://www.electronjs.org/zh/docs/latest/api/shell#shellopenpathpath
             */
            items.push({
                type: MenuItemType.Action,
                options: {
                    icon: "iconOpenWindow",
                    label: this.i18n.menu.openWithDefaultProgram.label,
                    click: () => {
                        if (type === FileTreeNodeType.File) {
                            globalThis
                                .require("electron")
                                .shell
                                .openPath(path);
                        }
                        else {
                            globalThis
                                .require("electron")
                                .shell
                                .showItemInFolder(
                                    globalThis
                                        .require("path")
                                        .normalize(path)
                                );
                        }
                    },
                },
                root: true,
                folder: true,
                file: true,
            });

            /**
             * 在文件资源管理器中显示
             * REF: https://www.electronjs.org/zh/docs/latest/api/shell#shellshowiteminfolderfullpath
             */
            items.push({
                type: MenuItemType.Action,
                options: {
                    icon: "iconFolder",
                    label: this.i18n.menu.revealInExplorer.label,
                    click: () => {
                        globalThis
                            .require("electron")
                            .shell
                            .showItemInFolder(
                                globalThis
                                    .require("path")
                                    .normalize(path)
                            );
                    },
                },
                root: true,
                folder: true,
                file: true,
            });
        }

        items.push({
            type: MenuItemType.Separator,
            root: true,
            folder: true,
            file: true,
        });

        /* 复制 */
        items.push({
            type: MenuItemType.Submenu,
            options: {
                icon: "iconCopy",
                label: this.i18n.menu.copy.label,
            },
            submenu: (() => {
                const submenu: IMenuItem[] = [
                    /* 复制名称 */
                    {
                        type: MenuItemType.Action,
                        options: {
                            icon: ExplorerIcon.makeDefaultNodeIcon(type),
                            label: this.i18n.menu.copyName.label,
                            accelerator: name,
                            click: () => {
                                copyText(name);
                            },
                        },
                        root: true,
                        folder: true,
                        file: true,
                    },
                    /* 复制相对路径 */
                    {
                        type: MenuItemType.Action,
                        options: {
                            icon: "iconCopy",
                            label: this.i18n.menu.copyRelativePath.label,
                            accelerator: relative,
                            click: () => {
                                copyText(relative);
                            },
                        },
                        root: true,
                        folder: true,
                        file: true,
                    },
                    /* 复制完整路径 */
                    {
                        type: MenuItemType.Action,
                        options: {
                            icon: "iconCopy",
                            label: this.i18n.menu.copyFullPath.label,
                            accelerator: path,
                            click: () => {
                                copyText(path);
                            },
                        },
                        root: true,
                        folder: true,
                        file: true,
                    },
                ];
                if (accessible) {
                    const pathname = workspacePath2StaticPathname(relative);
                    const url = new URL(`${globalThis.document.baseURI}${pathname}`);
                    const link1 = `[${name}](<${pathname}>)`;
                    const link2 = `[${name}](<${url.href}>)`;
                    const link1_accelerator = `[${name}](&lt;${pathname}&gt;)`;
                    const link2_accelerator = `[${name}](&lt;${url.href}&gt;)`;
                    submenu.push(
                        /* 复制引用路径 */
                        {
                            type: MenuItemType.Action,
                            options: {
                                icon: "iconLink",
                                label: this.i18n.menu.copyReferencePath.label,
                                accelerator: pathname,
                                click: () => {
                                    copyText(pathname);
                                },
                            },
                            root: true,
                            folder: true,
                            file: true,
                        },
                        /* 复制 URL */
                        {
                            type: MenuItemType.Action,
                            options: {
                                icon: "iconLink",
                                label: this.i18n.menu.copyURL.label,
                                accelerator: url.href,
                                click: () => {
                                    copyText(url.href);
                                },
                            },
                            root: true,
                            folder: true,
                            file: true,
                        },
                        /* 复制 Markdown 超链接 */
                        {
                            type: MenuItemType.Action,
                            options: {
                                icon: "iconMarkdown",
                                label: this.i18n.menu.copyMarkdownHyperlink.label,
                                accelerator: link1_accelerator,
                                click: () => {
                                    copyText(link1);
                                },
                            },
                            root: true,
                            folder: true,
                            file: true,
                        },
                        {
                            type: MenuItemType.Action,
                            options: {
                                icon: "iconMarkdown",
                                label: this.i18n.menu.copyMarkdownHyperlink.label,
                                accelerator: link2_accelerator,
                                click: () => {
                                    copyText(link2);
                                },
                            },
                            root: true,
                            folder: true,
                            file: true,
                        },
                    );
                }
                return submenu;
            })(),
            root: true,
            folder: true,
            file: true,
        });

        items.push({
            type: MenuItemType.Separator,
            root: true,
            folder: true,
            file: true,
        });

        // TODO: 另存为

        // TODO: 下载

        // TODO: 上传

        /* 重命名 */
        items.push({
            type: MenuItemType.Action,
            options: {
                icon: "iconEdit",
                label: this.i18n.menu.rename.label,
                click: () => {
                    const parent = this.explorer.path2node(get(node.directory));
                    const siblings = get(parent.children);
                    const siblings_names: Set<string> = siblings // 同级资源名称列表
                        ? new Set(siblings.map(node => node.name))
                        : null;
                    this.rename(
                        parent,
                        siblings_names,
                        name,
                        get(parent.relative),
                        get(node.type) === FileTreeNodeType.Folder,
                    );
                },
            },
            root: false,
            folder: true,
            file: true,
        });

        // TODO: 删除

        return items;
    }

    /**
     * 新建文件/文件夹弹出框
     * @param node: 当前目录节点
     * @param names: 当前目录下资源名称集合
     * @param relative: 当前目录相对路径
     * @param isDir: 是否为创建文件夹
     */
    public create(
        node: IFileTreeNodeStores,
        names: Set<string> | null,
        relative: string,
        isDir: boolean,
    ): void {
        const foldername = fn__code(relative);
        const i10n = isDir
            ? this.i18n.menu.newFolder
            : this.i18n.menu.newFile;

        /* 文件/文件名检查函数 */
        const check = async (value, _dialog, _component) => {
            const filename = fn__code(value);
            switch (true) {
                case value === "": // 文件夹名不能为空
                    return ft__error(i10n.tips.empty);
                case !isValidName(value): // 无效的文件名
                    return ft__error(i10n.tips.invalid
                        .replaceAll("${1}", filename)
                    );
                case !names: // 下级目录集合不存在, 更新集合
                    {
                        names = new Set();
                        const response = await this.plugin.client.readDir({ path: relative });
                        response.data.forEach(item => names.add(item.name));
                    }
                case names.has(value): // 存在同名文件
                    return ft__error(i10n.tips.exist
                        .replaceAll("${1}", foldername)
                        .replaceAll("${2}", filename)
                    );
                default: // 文件名有效
                    return i10n.tips.normal
                        .replaceAll("${1}", filename);
            }
        };
        prompt(
            this.plugin.siyuan.Dialog,
            {
                title: i10n.label,
                text: i10n.text.replaceAll("${1}", foldername),
                placeholder: i10n.placeholder,
                tips: i10n.tips.pleaseEnter,
                width: "32em",
                input: check,
                change: check,
                confirm: async (value) => {
                    let valid = false; // 文件名是否有效
                    switch (true) {
                        case value === "": // 文件夹名为空
                        case !isValidName(value): // 无效的文件名
                        case !names || names.has(value): // 存在同名文件
                            valid = false;
                        default: // 文件名有效
                            valid = true;
                    }
                    if (valid) {
                        await this.plugin.client.putFile({
                            isDir,
                            path: join(relative, value),
                            file: "",
                        });
                        this.explorer.updateNode(node);
                        return true;
                    }
                    else return false;
                },
            },
        );
    }

    /**
     * 文件/文件夹重命名弹出框
     * @param parentNode: 当前节点的上级节点
     * @param siblingsNames: 当前节点同级节点名称
     * @param oldname: 原名称
     * @param parentRelative: 当前节点的上级节点的相对路径
     * @param isDir: 是否为文件夹重命名
     */
    public rename(
        parentNode: IFileTreeNodeStores,
        siblingsNames: Set<string> | null,
        oldname: string,
        parentRelative: string,
        isDir: boolean,
    ): void {
        const foldername = fn__code(parentRelative);
        const i10n = isDir
            ? this.i18n.menu.renameFolder
            : this.i18n.menu.renameFile;

        /* 文件/文件名检查函数 */
        const check = async (value, _dialog, _component) => {
            const newname = fn__code(value);
            switch (true) {
                case value === "": // 文件夹名不能为空
                    return ft__error(i10n.tips.empty);
                case !isValidName(value): // 无效的文件名
                    return ft__error(i10n.tips.invalid
                        .replaceAll("${1}", newname)
                    );
                case value === oldname: // 新名称与原名称一致
                    return ft__primary(i10n.tips.same);
                case !siblingsNames: // 下级目录集合不存在, 更新集合
                    {
                        siblingsNames = new Set();
                        const response = await this.plugin.client.readDir({ path: parentRelative });
                        response.data.forEach(item => siblingsNames.add(item.name));
                    }
                case siblingsNames.has(value): // 存在同名文件
                    return ft__error(i10n.tips.exist
                        .replaceAll("${1}", foldername)
                        .replaceAll("${2}", newname)
                    );
                default: // 文件名有效
                    return i10n.tips.normal
                        .replaceAll("${1}", fn__code(oldname))
                        .replaceAll("${2}", newname);
            }
        };
        prompt(
            this.plugin.siyuan.Dialog,
            {
                title: i10n.label,
                text: i10n.text.replaceAll("${1}", foldername),
                value: oldname,
                placeholder: i10n.placeholder,
                tips: i10n.tips.pleaseEnter,
                width: "32em",
                input: check,
                change: check,
                confirm: async (value) => {
                    let valid = false; // 文件名是否有效
                    switch (true) {
                        case value === "": // 文件夹名为空
                        case !isValidName(value): // 无效的文件名
                        case value === oldname: // 新名称与原名称一致
                        case !siblingsNames || siblingsNames.has(value): // 存在同名文件
                            valid = false;
                        default: // 文件名有效
                            valid = true;
                    }
                    if (valid) {
                        await this.plugin.client.renameFile({
                            path: join(parentRelative, oldname),
                            newPath: join(parentRelative, value),
                        });
                        this.explorer.updateNode(parentNode);
                        return true;
                    }
                    else return false;
                },
            },
        );
    }
}
