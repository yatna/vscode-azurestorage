/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import StorageManagementClient = require('azure-arm-storage');
import { StorageAccount } from 'azure-arm-storage/lib/models';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, createAzureClient, ICreateChildImplContext, IStorageAccountWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupListStep, StorageAccountKind, StorageAccountPerformance, StorageAccountReplication, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import { ISelectStorageAccountContext } from '../commands/selectStorageAccountNodeForCommand';
import { nonNull, StorageAccountWrapper } from '../utils/storageWrappers';
import { AttachedStorageAccountTreeItem } from './AttachedStorageAccountTreeItem';
import { StaticWebsiteConfigureStep } from './createWizard/StaticWebsiteConfigureStep';
import { StaticWebsiteEnableStep } from './createWizard/StaticWebsiteEnableStep';
import { StaticWebsiteErrorDocument404Step } from './createWizard/StaticWebsiteErrorDocument404Step';
import { StaticWebsiteIndexDocumentStep } from './createWizard/StaticWebsiteIndexDocumentStep';
import { StorageAccountCreateStep } from './createWizard/storageAccountCreateStep';
import { StorageAccountNameStep } from './createWizard/storageAccountNameStep';
import { IStorageAccountTreeItemCreateContext, StorageAccountTreeItemCreateStep } from './createWizard/StorageAccountTreeItemCreateStep';
import { StorageAccountTreeItem } from './StorageAccountTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public childTypeLabel: string = "Storage Account";
    public supportsAdvancedCreation: boolean = true;

    async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {

        let base_url = "https://management.azure.com/";
        var metadata = {
            galleryEndpoint: "https://gallery.azure.com/",
            graphEndpoint: "https://graph.windows.net/",
            portalEndpoint: "https://portal.azure.com/",
            authentication: {
                loginEndpoint: "https://login.windows.net/",
                audiences: [
                    "https://management.core.windows.net/"
                ]
            }
        };
        var env = this.root.environment;
        env.name = "AzureStack";
        env.portalUrl = metadata.portalEndpoint;
        env.resourceManagerEndpointUrl = base_url;
        env.galleryEndpointUrl = metadata.galleryEndpoint;
        env.activeDirectoryEndpointUrl = metadata.authentication.loginEndpoint.slice(0, metadata.authentication.loginEndpoint.lastIndexOf("/") + 1);
        env.activeDirectoryResourceId = metadata.authentication.audiences[0];
        env.activeDirectoryGraphResourceId = metadata.graphEndpoint;
        env.storageEndpointSuffix = base_url.substring(base_url.indexOf('.'));
        env.keyVaultDnsSuffix = ".vault" + base_url.substring(base_url.indexOf('.'));
        env.managementEndpointUrl = metadata.authentication.audiences[0];
        this.root.environment = env;

        let storageManagementClient = createAzureClient(this.root, StorageManagementClient);
        let accounts = await storageManagementClient.storageAccounts.list();
        return this.createTreeItemsWithErrorHandling(
            accounts,
            'invalidStorageAccount',
            async (sa: StorageAccount) => await StorageAccountTreeItem.createStorageAccountTreeItem(this, new StorageAccountWrapper(sa), storageManagementClient),
            (sa: StorageAccount) => {
                return sa.name;
            }
        );
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzureTreeItem> {
        const defaultLocation = 'westus';
        const wizardContext: IStorageAccountWizardContext = Object.assign(context, this.root);
        const promptSteps: AzureWizardPromptStep<IStorageAccountWizardContext>[] = [new StorageAccountNameStep()];
        const executeSteps: AzureWizardExecuteStep<IStorageAccountWizardContext>[] = [
            new StorageAccountCreateStep({ kind: StorageAccountKind.StorageV2, performance: StorageAccountPerformance.Standard, replication: StorageAccountReplication.LRS }),
            new StorageAccountTreeItemCreateStep(this),
            new StaticWebsiteConfigureStep()
        ];

        if (context.advancedCreation) {
            promptSteps.push(new ResourceGroupListStep());
            promptSteps.push(new StaticWebsiteEnableStep());
            LocationListStep.addStep(wizardContext, promptSteps);
        } else {
            executeSteps.push(new ResourceGroupCreateStep());
            Object.assign(wizardContext, {
                enableStaticWebsite: true,
                indexDocument: StaticWebsiteIndexDocumentStep.defaultIndexDocument,
                errorDocument404Path: StaticWebsiteErrorDocument404Step.defaultErrorDocument404Path
            });
            await LocationListStep.setLocation(wizardContext, defaultLocation);
        }

        const wizard = new AzureWizard(wizardContext, {
            title: "Create storage account",
            promptSteps,
            executeSteps
        });

        await wizard.prompt();

        if (!context.advancedCreation) {
            wizardContext.newResourceGroupName = await wizardContext.relatedNameTask;
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
            context.showCreatingTreeItem(nonNull(wizardContext.newStorageAccountName));
            progress.report({ message: `Creating storage account '${wizardContext.newStorageAccountName}'` });
            await wizard.execute();
        });

        // In case this account has been created via a deploy or browse command, the enable website hosting prompt shouldn't be shown
        (<ISelectStorageAccountContext>context).showEnableWebsiteHostingPrompt = false;

        return (<IStorageAccountTreeItemCreateContext>wizardContext).accountTreeItem;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue !== AttachedStorageAccountTreeItem.baseContextValue && contextValue !== AttachedStorageAccountTreeItem.emulatedContextValue;
    }
}
