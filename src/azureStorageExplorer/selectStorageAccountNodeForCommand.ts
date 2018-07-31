/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode, IAzureParentNode, IAzureTreeItem } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";
import { BlobContainerNode } from "./blobContainers/blobContainerNode";
import { StorageAccountNode } from "./storageAccounts/storageAccountNode";

/**
 * Given a node argument for a command, if it is:
 *   1) undefined, then query the user for a storage account
 *   2) a storage account node, then return it
 *   3) a blob container node, then return the storage account node
 *   4) anything else, then throw an internal error
 */
export async function selectStorageAccountNodeForCommand(
    node: IAzureNode<IAzureTreeItem> | undefined
): Promise<IAzureParentNode<StorageAccountNode>> {
    // Node should be one of:
    //   undefined
    //   a storage account node
    //   a blob container node

    let storageOrContainerNode = <IAzureNode<StorageAccountNode> | IAzureNode<BlobContainerNode>>node;
    if (!storageOrContainerNode) {
        storageOrContainerNode = <IAzureNode<StorageAccountNode>>await ext.tree.showNodePicker(StorageAccountNode.contextValue);
    }

    let accountNode: IAzureParentNode<StorageAccountNode>;
    if (storageOrContainerNode.treeItem instanceof BlobContainerNode) {
        // Currently the portal only allows configuring at the storage account level, so retrieve the storage account node
        accountNode = storageOrContainerNode.treeItem.getStorageAccountNode(node);
    } else if (storageOrContainerNode.treeItem instanceof StorageAccountNode) {
        accountNode = <IAzureParentNode<StorageAccountNode>>storageOrContainerNode;
    } else {
        throw new Error(`Internal error: Unexpected node type: ${node.treeItem.contextValue}`);
    }

    return accountNode;
}
