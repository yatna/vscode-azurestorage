/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { StorageManagementClient } from 'azure-arm-storage';
import * as azureStorage from "azure-storage";
// tslint:disable-next-line:no-require-imports
import opn = require('opn');
import * as path from 'path';
import { commands, MessageItem, Uri, window } from 'vscode';
import { IActionContext, IAzureNode, IAzureParentNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { StorageAccount, StorageAccountKey } from '../../../node_modules/azure-arm-storage/lib/models';
import * as constants from "../../constants";
import { ext } from '../../extensionVariables';
import { BlobContainerGroupNode } from '../blobContainers/blobContainerGroupNode';
import { BlobContainerNode } from "../blobContainers/blobContainerNode";
import { FileShareGroupNode } from '../fileShares/fileShareGroupNode';
import { QueueGroupNode } from '../queues/queueGroupNode';
import { TableGroupNode } from '../tables/tableGroupNode';
import { WebsiteHostingStatus } from '../websiteHostingStatus';

type StorageTypes = 'Storage' | 'StorageV2' | 'BlobStorage';

const defaultIconPath: { light: string | Uri; dark: string | Uri } = {
    light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'AzureStorageAccount_16x.png'),
    dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'AzureStorageAccount_16x.png')
};

const websiteIconPath: { light: string | Uri; dark: string | Uri } = {
    light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'Website.svg'),
    dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'Website.svg')
};

export class StorageAccountNode implements IAzureParentTreeItem {
    constructor(
        public readonly storageAccount: StorageAccount,
        public readonly storageManagementClient: StorageManagementClient
    ) {
    }

    public id: string = this.storageAccount.id;
    public label: string = this.storageAccount.name;
    public static contextValue: string = 'azureStorageAccount';
    public contextValue: string = StorageAccountNode.contextValue;
    public iconPath: { light: string | Uri; dark: string | Uri } = defaultIconPath;

    private _blobContainerGroupNodePromise: Promise<BlobContainerGroupNode>;
    private _websiteHostingStatus: WebsiteHostingStatus;

    // Call this before giving this node to vscode
    public set websiteHostingStatus(value: WebsiteHostingStatus) {
        this._websiteHostingStatus = value;
        this.iconPath = value.enabled ? websiteIconPath : defaultIconPath;
    }
    public get websiteHostingStatus(): WebsiteHostingStatus {
        return this._websiteHostingStatus;
    }

    private async getBlobContainerGroupNode(): Promise<BlobContainerGroupNode> {
        assert(this.iconPath && typeof !!this.websiteHostingStatus, "Haven't set websiteHostingStatus");

        const createBlobContainerGroupNode = async (): Promise<BlobContainerGroupNode> => {
            let primaryKey = await this.getPrimaryKey();
            return new BlobContainerGroupNode(this.storageAccount, primaryKey, this.websiteHostingStatus);
        };

        if (!this._blobContainerGroupNodePromise) {
            this._blobContainerGroupNodePromise = createBlobContainerGroupNode();
        }

        return await this._blobContainerGroupNodePromise;
    }

    async loadMoreChildren(_node: IAzureNode, _clearCache: boolean): Promise<IAzureTreeItem[]> {
        let primaryKey = await this.getPrimaryKey();
        let primaryEndpoints = this.storageAccount.primaryEndpoints;
        let groupNodes = [];

        if (!!primaryEndpoints.blob) {
            groupNodes.push(await this.getBlobContainerGroupNode());
        }

        if (!!primaryEndpoints.file) {
            groupNodes.push(new FileShareGroupNode(this.storageAccount, primaryKey));
        }

        if (!!primaryEndpoints.queue) {
            groupNodes.push(new QueueGroupNode(this.storageAccount, primaryKey));
        }

        if (!!primaryEndpoints.table) {
            groupNodes.push(new TableGroupNode(this.storageAccount, primaryKey));
        }

        return groupNodes;
    }

    hasMoreChildren(): boolean {
        return false;
    }

    async getPrimaryKey(): Promise<StorageAccountKey> {
        let keys: StorageAccountKey[] = await this.getKeys();
        let primaryKey = keys.find((key: StorageAccountKey) => {
            return key.keyName === "key1" || key.keyName === "primaryKey";
        });

        return primaryKey;
    }

    async getConnectionString(): Promise<string> {
        let primaryKey = await this.getPrimaryKey();
        return `DefaultEndpointsProtocol=https;AccountName=${this.storageAccount.name};AccountKey=${primaryKey.value}`;
    }

    async getKeys(): Promise<StorageAccountKey[]> {
        let parsedId = this.parseAzureResourceId(this.storageAccount.id);
        let resourceGroupName = parsedId.resourceGroups;
        let keyResult = await this.storageManagementClient.storageAccounts.listKeys(resourceGroupName, this.storageAccount.name);
        return keyResult.keys;
    }

    parseAzureResourceId(resourceId: string): { [key: string]: string } {
        const invalidIdErr = new Error('Invalid Account ID.');
        const result = {};

        if (!resourceId || resourceId.length < 2 || resourceId.charAt(0) !== '/') {
            throw invalidIdErr;
        }

        const parts = resourceId.substring(1).split('/');

        if (parts.length % 2 !== 0) {
            throw invalidIdErr;
        }

        for (let i = 0; i < parts.length; i += 2) {
            const key = parts[i];
            const value = parts[i + 1];

            if (key === '' || value === '') {
                throw invalidIdErr;
            }

            result[key] = value;
        }

        return result;
    }

    public async getWebsiteCapableContainer(node: IAzureParentNode<StorageAccountNode>): Promise<IAzureParentNode<BlobContainerNode> | undefined> {
        assert(node.treeItem === this);

        // Refresh the storage account first to make sure $web has been picked up if new
        await node.refresh();

        let groupTreeItem = <IAzureTreeItem>await this.getBlobContainerGroupNode();

        // Currently only the child with the name "$web" is supported for hosting websites
        let id = `${this.id}/${groupTreeItem.id || groupTreeItem.label}/${constants.staticWebsiteContainerName}`;
        let containerNode = <IAzureParentNode<BlobContainerNode>>await node.treeDataProvider.findNode(id);
        return containerNode;
    }

    // This is the URL to use for browsing the website
    public getPrimaryWebEndpoint(): string | undefined {
        // Right now Azure only supports one web endpoint per storage account
        return this.storageAccount.primaryEndpoints.web;
    }

    public async createBlobService(): Promise<azureStorage.BlobService> {
        let primaryKey = await this.getPrimaryKey();
        let blobService = azureStorage.createBlobService(this.storageAccount.name, primaryKey.value);
        return blobService;
    }

    public async setWebsiteHostingProperties(staticWebsiteProperties: azureStorage.common.models.ServicePropertiesResult.StaticWebsiteProperties): Promise<WebsiteHostingStatus> {
        let blobService = await this.createBlobService();

        return await new Promise<WebsiteHostingStatus>((resolve, reject) => {
            blobService.getServiceProperties((err, props: azureStorage.common.models.ServicePropertiesResult.BlobServiceProperties) => {
                if (err) {
                    reject(err);
                } else {
                    props.StaticWebsite = {
                        Enabled: staticWebsiteProperties.Enabled,
                        IndexDocument: staticWebsiteProperties.IndexDocument || undefined,
                        ErrorDocument404Path: staticWebsiteProperties.ErrorDocument404Path || undefined
                    };
                    blobService.setServiceProperties(props, (err2, _response) => {
                        if (err2) {
                            reject(err2);
                        } else {
                            resolve();
                        }
                    });
                }
            });
        });
    }

    public async getWebsiteHostingStatus(): Promise<WebsiteHostingStatus> {
        let blobService = await this.createBlobService();

        return await new Promise<WebsiteHostingStatus>((resolve, reject) => {
            blobService.getServiceProperties((err, result: azureStorage.common.models.ServicePropertiesResult.BlobServiceProperties) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        capable: !!result.StaticWebsite,
                        enabled: result.StaticWebsite && result.StaticWebsite.Enabled,
                        indexDocument: result.StaticWebsite && result.StaticWebsite.IndexDocument,
                        errorDocument404Path: result.StaticWebsite && result.StaticWebsite.ErrorDocument404Path
                    });
                }
            });
        });
    }

    private async getAccountType(): Promise<StorageTypes> {
        let blobService = await this.createBlobService();
        return await new Promise<StorageTypes>((resolve, reject) => {
            blobService.getAccountProperties(undefined, undefined, undefined, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(<StorageTypes>result.AccountKind);
                }
            });
        });
    }

    public async enableAndConfigureStaticWebsite(node: IAzureNode): Promise<void> {
        const defaultIndexDocumentName = 'index.html';
        assert(node.treeItem === this);
        let oldStatus = await this.getWebsiteHostingStatus();
        await this.ensureHostingCapable(oldStatus);

        let indexDocument = await ext.ui.showInputBox({
            ignoreFocusOut: true,
            prompt: "Enter the index document name",
            value: oldStatus.indexDocument || defaultIndexDocumentName,
            validateInput: (value: string) => {
                if (!value) {
                    return "Index document name should not be left blank";
                }
                return undefined;
            }
        });

        let errorDocument404Path: string = await ext.ui.showInputBox({
            ignoreFocusOut: true,
            prompt: "Enter the path to your 404 document (optional)",
            value: oldStatus.errorDocument404Path || "",
            placeHolder: 'e.g. error/documents/error.html',
            validateInput: (value: string): string | undefined => {
                if (value) {
                    if (value.startsWith('/') || value.endsWith('/')) {
                        return "If specified, the error document path must not begin or end with a '/' character.";
                    } else if (value.length < 3 || value.length > 255) {
                        return "If specified, the error document path must be between 3 and 255 characters in length";
                    }
                }
                return undefined;
            }
        });

        let newStatus: azureStorage.common.models.ServicePropertiesResult.StaticWebsiteProperties = {
            Enabled: true,
            ErrorDocument404Path: errorDocument404Path,
            IndexDocument: indexDocument
        };
        await this.setWebsiteHostingProperties(newStatus);
        let msg = oldStatus.enabled ?
            'Static website hosting configuration updated' :
            'The storage account has been enabled for static website hosting';
        window.showInformationMessage(msg);
        if (!oldStatus.enabled) {
            await ext.tree.refresh();
        }
    }

    // Note: It's assumed the site has already been enabled and configured (using selectStorageAccountNodeForCommand)
    public async browseStaticWebsite(node: IAzureNode, actionContext: IActionContext): Promise<void> {
        assert(node.treeItem === this);

        let hostingStatus = await this.getWebsiteHostingStatus();
        hostingStatus = await this.ensureHostingCapable(hostingStatus);
        hostingStatus = await this.ensureHostingEnabled(hostingStatus, node, actionContext);

        await node.refresh();
        let endpoint = this.getPrimaryWebEndpoint();
        if (endpoint) {
            await opn(endpoint);
        } else {
            throw new Error(`Could not retrieve the primary web endpoint for ${this.label}`);
        }
    }

    public async ensureHostingCapable(hostingStatus: WebsiteHostingStatus): Promise<WebsiteHostingStatus> {
        if (!hostingStatus.capable) {
            // Doesn't support static website hosting. Try to narrow it down.
            let accountType: StorageTypes;
            try {
                accountType = await this.getAccountType();
            } catch (error) {
                // Ignore errors
            }
            if (accountType !== 'StorageV2') {
                throw new Error("Only general purpose V2 storage accounts support static website hosting.");
            }

            throw new Error("This storage account does not support static website hosting.");
        }

        // This is never changed in this function, but return it for consistency with the other similar functions
        return hostingStatus;
    }

    public async ensureHostingEnabled(hostingStatus: WebsiteHostingStatus, node: IAzureNode<IAzureTreeItem>, actionContext: IActionContext): Promise<WebsiteHostingStatus> {
        await this.ensureHostingCapable(hostingStatus);

        if (!hostingStatus.enabled) {
            let msg = `Static website hosting is not enabled for storage account "${this.storageAccount.name}". Would you like to enable it?`;
            const enable: MessageItem = {
                title: "Enable website hosting"
            };
            let enableResult = await window.showErrorMessage(msg, enable);
            if (enableResult === enable) {
                await commands.executeCommand('azureStorage.configureStaticWebsite', node);
                let newStatus = await this.getWebsiteHostingStatus();
                if (!newStatus.enabled) {
                    throw new Error(`Storage account "${this.storageAccount.name}" should now be enabled for static website hosting, but is not`);
                }
                return newStatus;
            } else {
                actionContext.properties.cancelStep = 'WebsiteHostingNotEnabled';
                throw new UserCancelledError(msg);
            }
        }

        return hostingStatus;
    }

    public async ensureIndexDocumentSet(node: IAzureNode<IAzureTreeItem>, hostingStatus: WebsiteHostingStatus, actionContext: IActionContext): Promise<void> {
        assert(hostingStatus.capable);
        assert(hostingStatus.enabled);

        if (!hostingStatus.indexDocument) {
            let msg = "No index document has been set for this website.";
            const configure: MessageItem = {
                title: "Configure index document and 404 path"
            };
            let result = await window.showErrorMessage(msg, configure);
            if (result === configure) {
                commands.executeCommand('azureStorage.configureStaticWebsite', node);
            } else {
                actionContext.properties.cancelStep = 'NoIndexDocumentHasBeenSet';
                throw new UserCancelledError(msg);
            }
        }
    }
}
