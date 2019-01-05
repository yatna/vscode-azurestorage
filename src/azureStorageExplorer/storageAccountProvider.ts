/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tslint:disable-next-line:no-require-imports
import * as armResource from 'azure-arm-resource';
import { StorageManagementClient } from 'azure-arm-storage';
import { CheckNameAvailabilityResult, StorageAccount } from 'azure-arm-storage/lib/models';
import * as vscode from 'vscode';
import { AzureTreeItem, createAzureClient, createTreeItemsWithErrorHandling, SubscriptionTreeItem } from 'vscode-azureextensionui';
import { StorageAccountWrapper } from '../components/storageWrappers';
import { StorageAccountTreeItem } from './storageAccounts/storageAccountNode';

export class StorageAccountProvider extends SubscriptionTreeItem {
    public childTypeLabel: string = "Storage Account";

    async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem[]> {
        let storageManagementClient = createAzureClient(this.root, StorageManagementClient);

        let accounts = await storageManagementClient.storageAccounts.list();
        return createTreeItemsWithErrorHandling(
            this,
            accounts,
            'invalidStorageAccount',
            async (sa: StorageAccount) => {
                return await StorageAccountTreeItem.createStorageAccountTreeItem(this, new StorageAccountWrapper(sa), storageManagementClient);
            },
            (sa: StorageAccount) => {
                return sa.name;
            }
        );
    }

    hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<StorageAccountProvider> {
        let storageManagementClient = createAzureClient(this.root, StorageManagementClient);
        let resourceClient = createAzureClient(this.root, armResource.ResourceManagementClient);

        const accountName = await vscode.window.showInputBox({
            prompt: "Enter name for account you wish to create",
            validateInput: (value: string) => {
                let result: string | undefined;
                storageManagementClient.storageAccounts.checkNameAvailability(value).then((response: CheckNameAvailabilityResult) => {
                    if (!response.nameAvailable) {
                        result = <string>response.message + <string>response.reason;
                    } else {
                        result = undefined;
                    }
                });
                return result;
            }

        });
        if (accountName) {
            showCreatingTreeItem(accountName);
        }

        let resourceGroups = await resourceClient.resourceGroups.list();
        let chosenResourceGroup = vscode.window.showQuickPick();

        storageManagementClient.storageAccounts.create();

        return this;
    }
}
