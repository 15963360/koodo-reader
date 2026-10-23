import { RouteComponentProps } from "react-router-dom";
import { NeatReaderCloudBook } from "../../../utils/neatreader/api";

export interface SettingInfoProps extends RouteComponentProps<any> {
  t: (title: string, options?: any) => string;
  isAuthed: boolean;
  handleFetchBooks: () => void;
}

export interface SettingInfoState {
  isLoggedIn: boolean;
  userName: string;
  accountInput: string;
  passwordInput: string;
  tokenInput: string;
  isLoggingIn: boolean;
  cloudBooks: NeatReaderCloudBook[];
  cloudSize: number;
  cloudBookNum: number;
  isLoadingList: boolean;
  isDownloadingAll: boolean;
  downloadingGuid: string;
  importedGuids: string[];
  statusText: string;
}
