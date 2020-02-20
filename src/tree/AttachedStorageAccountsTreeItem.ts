/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import StorageManagementClient from 'azure-arm-storage';
import { StorageAccount, StorageAccountKey } from 'azure-arm-storage/lib/models';
import { ServiceClientCredentials } from 'ms-rest';
import { AzureEnvironment } from 'ms-rest-azure';
import * as path from 'path';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { AzExtParentTreeItem, AzExtTreeItem, AzureParentTreeItem, GenericTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { getResourcesPath } from '../constants';
import { ext } from '../extensionVariables';
import { connectionStringPlaceholder, IParsedConnectionString, parseConnectionString } from '../utils/connectionStringUtils';
import { StorageAccountWrapper } from '../utils/storageWrappers';
import { StorageAccountTreeItem } from './StorageAccountTreeItem';

interface IPersistedAccount {
    name: string;
    key: StorageAccountKey;
    primaryEndpoints: IPrimaryEndpoints;
}

interface IPrimaryEndpoints {
    blob: string;
    table: string;
    queue: string;
    file?: string; // The emulator doesn't support file shares
}

export const attachedAccountSuffix: string = 'Attached';

export class AttachedStorageAccountsTreeItem extends AzureParentTreeItem {
    public readonly contextValue: string = 'attachedStorageAccounts';
    public readonly id: string = 'attachedStorageAccounts';
    public readonly label: string = 'Attached Storage Accounts';
    public childTypeLabel: string = 'Account';

    private _root: ISubscriptionContext;
    private _attachedAccounts: StorageAccountTreeItem[] | undefined;
    private _loadPersistedAccountsTask: Promise<StorageAccountTreeItem[]>;
    private readonly _serviceName: string = "ms-azuretools.vscode-azurestorage.connectionStrings";
    private readonly _emulatorAccountName: string = 'devstoreaccount1';
    private readonly _emulatorBlobPort: number = 10000;
    private readonly _emulatorTablePort: number = 10002;
    private readonly _emulatorQueuePort: number = 10001;
    private _emulatorAccountKey: string = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
    private readonly _storageAccountType: string = 'Microsoft.Storage/storageAccounts';

    constructor(parent: AzExtParentTreeItem) {
        super(parent);
        // tslint:disable-next-line: no-use-before-declare
        this._root = new AttachedAccountRoot();
        this._loadPersistedAccountsTask = this.loadPersistedAccounts();
    }

    public get root(): ISubscriptionContext {
        return this._root;
    }

    public get iconPath(): { light: string | Uri; dark: string | Uri } {
        return {
            light: path.join(getResourcesPath(), 'light', 'ConnectPlugged.svg'),
            dark: path.join(getResourcesPath(), 'dark', 'ConnectPlugged.svg')
        };
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (clearCache) {
            this._attachedAccounts = undefined;
            this._loadPersistedAccountsTask = this.loadPersistedAccounts();
        }

        const attachedAccounts: StorageAccountTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.length === 0) {
            return [new GenericTreeItem(this, {
                contextValue: 'azureStorageAttachAccount',
                label: 'Attach Storage Account...',
                commandId: 'azureStorage.attachStorageAccount',
                includeInTreeItemPicker: true
            })];
        }

        return attachedAccounts;
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        // We have to make sure the Attached Accounts node is not shown for commands like
        // 'Open in Portal', which only work for the non-attached version
        return contextValue !== StorageAccountTreeItem.contextValue;
    }

    public async attachWithConnectionString(): Promise<void> {
        const connectionString = await vscode.window.showInputBox({
            placeHolder: connectionStringPlaceholder,
            prompt: 'Enter the connection string for your storage account',
            ignoreFocusOut: true,
        });

        if (connectionString) {
            let parsedConnectionString: IParsedConnectionString = parseConnectionString(connectionString);
            await this.attachAccount(await this.createTreeItem(
                parsedConnectionString.accountName,
                this.getStorageAccountKey(parsedConnectionString.accountKey),
                {
                    blob: this.getAttachedAccountEndpoint(parsedConnectionString, 'blob'),
                    file: this.getAttachedAccountEndpoint(parsedConnectionString, 'file'),
                    queue: this.getAttachedAccountEndpoint(parsedConnectionString, 'queue'),
                    table: this.getAttachedAccountEndpoint(parsedConnectionString, 'table')
                }
            ));
        }
    }

    public async attachEmulator(): Promise<void> {
        await this.attachAccount(await this.createTreeItem(
            this._emulatorAccountName,
            this.getStorageAccountKey(this._emulatorAccountKey),
            {
                blob: this.getEmulatorEndpoint(this._emulatorBlobPort),
                queue: this.getEmulatorEndpoint(this._emulatorQueuePort),
                table: this.getEmulatorEndpoint(this._emulatorTablePort)
            }
        ));
    }

    public async detach(treeItem: StorageAccountTreeItem): Promise<void> {
        let updatedAttachedAccounts: StorageAccountTreeItem[] = [];

        const value: string | undefined = ext.context.globalState.get(this._serviceName);
        if (value) {
            const accounts: IPersistedAccount[] = <IPersistedAccount[]>JSON.parse(value);
            await Promise.all(accounts.map(async account => {
                if (treeItem.storageAccount.name !== account.name) {
                    updatedAttachedAccounts.push(await this.createTreeItem(account.name, account.key, account.primaryEndpoints));
                }
            }));
        }

        await this.persistIds(updatedAttachedAccounts);
    }

    private async getAttachedAccounts(): Promise<StorageAccountTreeItem[]> {
        if (!this._attachedAccounts) {
            try {
                this._attachedAccounts = await this._loadPersistedAccountsTask;
            } catch {
                this._attachedAccounts = [];
                throw new Error('Failed to load persisted Storage Accounts. Accounts must be reattached manually.');
            }
        }

        return this._attachedAccounts;
    }

    private async attachAccount(treeItem: StorageAccountTreeItem): Promise<void> {
        const attachedAccounts: StorageAccountTreeItem[] = await this.getAttachedAccounts();

        if (attachedAccounts.find(s => s.id === treeItem.id)) {
            vscode.window.showWarningMessage(`Storage Account '${treeItem.id}' is already attached.`);
        } else {
            attachedAccounts.push(treeItem);
            await this.persistIds(attachedAccounts);
        }
    }

    private async loadPersistedAccounts(): Promise<StorageAccountTreeItem[]> {
        const persistedAccounts: StorageAccountTreeItem[] = [];
        const value: string | undefined = ext.context.globalState.get(this._serviceName);
        if (value) {
            // ext.context.globalState.update(this._serviceName, false);
            const accounts: IPersistedAccount[] = <IPersistedAccount[]>JSON.parse(value);
            await Promise.all(accounts.map(async account => {
                persistedAccounts.push(await this.createTreeItem(account.name, account.key, account.primaryEndpoints));
            }));
        }

        return persistedAccounts;
    }

    // tslint:disable-next-line:no-reserved-keywords
    private async createTreeItem(name: string, key: StorageAccountKey, primaryEndpoints: IPrimaryEndpoints): Promise<StorageAccountTreeItem> {
        let storageAccountWrapper: StorageAccountWrapper = new StorageAccountWrapper(<StorageAccount>{
            id: this.getAttachedAccountId(name),
            type: this._storageAccountType,
            name,
            primaryEndpoints
        });
        let treeItem: StorageAccountTreeItem = await StorageAccountTreeItem.createStorageAccountTreeItem(this, storageAccountWrapper, <StorageManagementClient>{}, key);
        treeItem.contextValue += attachedAccountSuffix;
        return treeItem;
    }

    private async persistIds(attachedAccounts: StorageAccountTreeItem[]): Promise<void> {
        const value: IPersistedAccount[] = attachedAccounts.map((treeItem: StorageAccountTreeItem) => {
            return <IPersistedAccount>{
                name: treeItem.storageAccount.name,
                key: treeItem.attachedAccountKey,
                primaryEndpoints: {
                    blob: treeItem.storageAccount.primaryEndpoints.blob,
                    table: treeItem.storageAccount.primaryEndpoints.table,
                    queue: treeItem.storageAccount.primaryEndpoints.queue,
                    file: treeItem.storageAccount.primaryEndpoints.file
                }
            };
        });
        await ext.context.globalState.update(this._serviceName, JSON.stringify(value));
    }

    private getAttachedAccountEndpoint(parsedConnectionString: IParsedConnectionString, endpointType: string): string {
        return `${parsedConnectionString.defaultEndpointsProtocol}://${parsedConnectionString.accountName}.${endpointType}.${parsedConnectionString.endpointSuffix}`;
    }

    private getEmulatorEndpoint(port: number): string {
        // tslint:disable-next-line:no-http-string
        return `http://127.0.0.1:${port}/${this._emulatorAccountName}`;
    }

    private getAttachedAccountId(name: string): string {
        return `/subscriptions/attached/resourceGroups/attached/providers/Microsoft.Storage/storageAccounts/${name}`;
    }

    private getStorageAccountKey(key: string): StorageAccountKey {
        return { keyName: 'primaryKey', value: key };
    }
}

class AttachedAccountRoot implements ISubscriptionContext {
    private _error: Error = new Error('Cannot retrieve Azure subscription information for an attached account.');

    public get credentials(): ServiceClientCredentials {
        throw this._error;
    }

    public get subscriptionDisplayName(): string {
        throw this._error;
    }

    public get subscriptionId(): string {
        throw this._error;
    }

    public get subscriptionPath(): string {
        throw this._error;
    }

    public get tenantId(): string {
        throw this._error;
    }

    public get userId(): string {
        throw this._error;
    }

    public get environment(): AzureEnvironment {
        throw this._error;
    }
}
