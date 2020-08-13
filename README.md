### How to build -
1. Git clone https://github.com/yatna/vscode-azurestorage.git
2. Open cloned folder in VSCode-Insiders
3. In VSCode Insiders , Go to Terminal->New Terminal
4. ```git checkout yatna```
5. ```npm install``` (Verify that both arm storage folder are created by looking in node_modules/@azure)
6. Update ```C:\Users\t-yaverm\AppData\Roaming\Code - Insiders\User\settings.json``` with appropriate endpoints (LH3 or Redmond ADFS or Local AAD) from - https://microsoft.sharepoint.com/teams/AzureStack/_layouts/15/Doc.aspx?sourcedoc={6aa9d641-17b3-46d5-a518-cdb44cb62bac}&action=edit&wd=target%28FUN-DEVEX.one%7C45b8f8a2-c475-4f34-a0b4-1700bd42d066%2FUntitled%20Page%7C967ba5da-801e-43b0-b1e2-a6dd610c7440%2F%29
7. Press F5 to run
