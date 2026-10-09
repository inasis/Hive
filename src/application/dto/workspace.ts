export type WorkspaceFileItemDto = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
};

export type WorkspaceFileListingDto = {
  path: string;
  items: WorkspaceFileItemDto[];
};

export type WorkspaceFileTextDto = {
  path: string;
  content: string;
  bytes: number;
};

export type WorkspaceFileWriteDto = {
  path: string;
  written: true;
  bytes: number;
};
