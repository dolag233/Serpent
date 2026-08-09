; Serpent Windows 安装器（Inno Setup，参考 VS Code build/win32/code.iss）。
; 多语言：ShowLanguageDialog=yes 始终显示语言选择（默认选中系统语言，
; 见 [Languages] 顺序与 Inno 检测逻辑）；向导含安装路径选择页；per-machine
; 安装（UAC 一开始提示）；卸载器 unins000.exe 自动生成。
; 构建：ISCC.exe assets\inno\serpentsetup.iss（SourceDir 指向打包产物父目录）

#define AppName "Serpent"
; 版本由 inno-build.mjs 从 package.json 以 -DAppVersion 传入（npm version 提升后
; 安装器版本自动跟随）；缺省 0.1.0 仅为直接手工编译 ISCC 时的兜底。
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define AppExeName "Serpent.exe"

[Setup]
AppId={{F3A7C2E1-9B5D-4E8A-8C3F-1D6B2A9E4C71}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=dolag233
AppPublisherURL=https://github.com/dolag233/Serpent
; autopf：按 PrivilegesRequired 自动选择（admin → Program Files）
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=..\..\out\make\inno
OutputBaseFilename=SerpentSetup
Compression=lzma
SolidCompression=yes
SetupIconFile=..\..\assets\icons\app.ico
UninstallDisplayIcon={app}\{#AppExeName}
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 语言选择：yes = 安装启动时始终显示语言选择对话框（默认选中系统语言）
ShowLanguageDialog=yes
WizardStyle=modern
; per-machine：安装到 Program Files，UAC 提权（产品要求"一开始提示"）
PrivilegesRequired=admin
CloseApplications=force

[Languages]
; 英文在前 → 系统语言不匹配时默认英文
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\out\Serpent-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
