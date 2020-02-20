/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IParsedConnectionString {
    defaultEndpointsProtocol: string;
    accountName: string;
    accountKey: string;
    endpointSuffix: string;
}

export const connectionStringPlaceholder: string = 'DefaultEndpointsProtocol=...;AccountName=...;AccountKey=...;EndpointSuffix=...';

export function parseConnectionString(connectionString: string): IParsedConnectionString {
    const defaultEndpointsProtocol: string | undefined = getPropertyFromConnectionString(connectionString, 'DefaultEndpointsProtocol');
    const accountName: string | undefined = getPropertyFromConnectionString(connectionString, 'AccountName');
    const accountKey: string | undefined = getPropertyFromConnectionString(connectionString, 'AccountKey');
    const endpointSuffix: string | undefined = getPropertyFromConnectionString(connectionString, 'EndpointSuffix');

    if (!defaultEndpointsProtocol || !accountName || !accountKey || !endpointSuffix) {
        throw new Error(`Invalid connection string. Format must match "${connectionStringPlaceholder}"`);
    }

    return { defaultEndpointsProtocol, accountName, accountKey, endpointSuffix };
}

function getPropertyFromConnectionString(connectionString: string, property: string): string | undefined {
    const regexp: RegExp = new RegExp(`(?:^|;)\\s*${property}=([^;]+)(?:;|$)`, 'i');
    // tslint:disable-next-line: strict-boolean-expressions
    const match: RegExpMatchArray | undefined = connectionString.match(regexp) || undefined;
    return match && match[1];
}
