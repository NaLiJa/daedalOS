import type { FSModule } from "browserfs/dist/node/core/FS";
import { monacoExtensions } from "components/apps/MonacoEditor/config";
import type { ExtensionType } from "components/system/Files/FileEntry/extensions";
import extensions from "components/system/Files/FileEntry/extensions";
import type { FileInfo } from "components/system/Files/FileEntry/useFileInfo";
import {
  FOLDER_ICON,
  UNKNOWN_ICON,
} from "components/system/Files/FileManager/useFolder";
import processDirectory from "contexts/process/directory";
import ini from "ini";
import { extname, join } from "path";
import {
  EMPTY_BUFFER,
  IMAGE_FILE_EXTENSIONS,
  MP3_MIME_TYPE,
  ONE_TIME_PASSIVE_EVENT,
  PREVIEW_FRAME_SECOND,
  SHORTCUT_EXTENSION,
  SYSTEM_FILES,
  SYSTEM_PATHS,
  VIDEO_FILE_EXTENSIONS,
} from "utils/constants";
import { bufferToUrl } from "utils/functions";

type InternetShortcut = {
  InternetShortcut: {
    BaseURL: string;
    IconFile: string;
    URL: string;
  };
};

type ShellClassInfo = {
  ShellClassInfo: {
    IconFile: string;
  };
};

export const getIconFromIni = (
  fs: FSModule,
  directory: string
): Promise<string> =>
  new Promise((resolve) =>
    fs.readFile(
      join(directory, "desktop.ini"),
      (error, contents = EMPTY_BUFFER) => {
        if (!error) {
          const {
            ShellClassInfo: { IconFile = "" },
          } = ini.parse(contents.toString()) as ShellClassInfo;

          if (IconFile) resolve(IconFile);
        }
      }
    )
  );

const getDefaultFileViewer = (extension: string): string => {
  if (monacoExtensions.has(extension)) return "MonacoEditor";
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return "Photos";
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return "VideoPlayer";

  return "";
};

export const getIconByFileExtension = (extension: string): string => {
  const { icon: extensionIcon = "", process: [defaultProcess = ""] = [] } =
    extension in extensions ? extensions[extension as ExtensionType] : {};

  if (extensionIcon) return `/System/Icons/${extensionIcon}.png`;

  return (
    processDirectory[defaultProcess || getDefaultFileViewer(extension)]?.icon ||
    UNKNOWN_ICON
  );
};

export const getProcessByFileExtension = (extension: string): string => {
  const [defaultProcess = ""] =
    extension in extensions
      ? extensions[extension as ExtensionType].process
      : [getDefaultFileViewer(extension)];

  return defaultProcess;
};

const getShortcutInfo = (contents: Buffer): FileInfo => {
  const {
    InternetShortcut: { BaseURL: pid = "", IconFile: icon = "", URL: url = "" },
  } = ini.parse(contents.toString()) as InternetShortcut;

  if (!icon && pid) {
    return { icon: processDirectory[pid]?.icon, pid, url };
  }

  return { icon, pid, url };
};

export const getInfoWithoutExtension = (
  fs: FSModule,
  path: string,
  isDirectory: boolean,
  callback: (value: FileInfo) => void
): void => {
  if (isDirectory) {
    const setFolderInfo = (icon: string): void =>
      callback({ icon, pid: "FileExplorer", url: path });

    setFolderInfo(FOLDER_ICON);
    getIconFromIni(fs, path).then(setFolderInfo);
  } else {
    callback({ icon: UNKNOWN_ICON, pid: "", url: "" });
  }
};

export const getInfoWithExtension = (
  fs: FSModule,
  path: string,
  extension: string,
  callback: (value: FileInfo) => void
): void => {
  const getInfoByFileExtension = (icon?: string): void =>
    callback({
      icon: icon || getIconByFileExtension(extension),
      pid: getProcessByFileExtension(extension),
      url: path,
    });

  if (extension === SHORTCUT_EXTENSION) {
    fs.readFile(path, (error, contents = EMPTY_BUFFER) => {
      if (error) {
        getInfoByFileExtension();
      } else {
        const { icon, pid, url } = getShortcutInfo(contents);
        const urlExt = extname(url);

        callback({ icon, pid, url });

        if (
          IMAGE_FILE_EXTENSIONS.has(urlExt) ||
          VIDEO_FILE_EXTENSIONS.has(urlExt) ||
          urlExt === ".mp3"
        ) {
          getInfoWithExtension(fs, url, urlExt, ({ icon: urlIcon }) => {
            if (urlIcon && urlIcon !== icon) {
              callback({ icon: urlIcon, pid, url });
            }
          });
        }
      }
    });
  } else if (IMAGE_FILE_EXTENSIONS.has(extension)) {
    getInfoByFileExtension("/System/Icons/photo.png");
    fs.readFile(path, (error, contents = EMPTY_BUFFER) => {
      if (!error) getInfoByFileExtension(bufferToUrl(contents));
    });
  } else if (VIDEO_FILE_EXTENSIONS.has(extension)) {
    // eslint-disable-next-line dot-notation
    getInfoByFileExtension(processDirectory["VideoPlayer"].icon);
    fs.readFile(path, (error, contents = EMPTY_BUFFER) => {
      if (!error) {
        const video = document.createElement("video");

        video.currentTime = PREVIEW_FRAME_SECOND;
        video.addEventListener(
          "loadeddata",
          () => {
            const canvas = document.createElement("canvas");

            canvas
              .getContext("2d")
              ?.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) =>
              getInfoByFileExtension(URL.createObjectURL(blob))
            );
          },
          ONE_TIME_PASSIVE_EVENT
        );

        video.src = bufferToUrl(contents);
        video.load();
      }
    });
  } else if (extension === ".mp3") {
    getInfoByFileExtension(`/System/Icons/${extensions[".mp3"].icon}.png`);
    fs.readFile(path, (error, contents = EMPTY_BUFFER) => {
      if (!error) {
        import("music-metadata-browser").then(({ parseBuffer, selectCover }) =>
          parseBuffer(
            contents,
            {
              mimeType: MP3_MIME_TYPE,
              size: contents.length,
            },
            { skipPostHeaders: true }
          ).then(({ common: { picture } = {} }) => {
            const { data: coverPicture } = selectCover(picture) || {};

            if (coverPicture) getInfoByFileExtension(bufferToUrl(coverPicture));
          })
        );
      }
    });
  } else {
    getInfoByFileExtension();
  }
};

export const filterSystemFiles =
  (directory: string) =>
  (file: string): boolean =>
    !SYSTEM_PATHS.has(join(directory, file)) && !SYSTEM_FILES.has(file);

export const getLineCount = (
  text: string,
  fontSize: string,
  fontFamily: string,
  maxWidth: number
): number => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  }) as CanvasRenderingContext2D;
  const lines = [""];

  context.font = `${fontSize} ${fontFamily}`;

  if (context.measureText(text).width > maxWidth) {
    [...text].forEach((character) => {
      const lineCount = lines.length - 1;
      const lineText = `${lines[lineCount]}${character}`;

      if (context.measureText(lineText).width > maxWidth) {
        lines.push(character);
      } else {
        lines[lineCount] = lineText;
      }
    });
  }

  return lines.length;
};
