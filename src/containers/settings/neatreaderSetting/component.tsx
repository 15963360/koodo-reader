import React from "react";
import "./neatreaderSetting.css";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import {
  NEATREADER_COVER_HOST,
  NeatReaderCloudBook,
  clearSession,
  formatCloudSize,
  getCloudBookList,
  getSession,
  getUserProfile,
  loginWithPassword,
  loginWithToken,
} from "../../../utils/neatreader/api";
import { importNeatReaderBook } from "../../../utils/neatreader/importer";

class NeatReaderSetting extends React.Component<
  SettingInfoProps,
  SettingInfoState
> {
  constructor(props: SettingInfoProps) {
    super(props);
    const session = getSession();
    this.state = {
      isLoggedIn: !!session,
      userName: session?.userName || "",
      accountInput: session?.userName || "",
      passwordInput: "",
      tokenInput: "",
      isLoggingIn: false,
      cloudBooks: [],
      cloudSize: 0,
      cloudBookNum: 0,
      isLoadingList: false,
      isDownloadingAll: false,
      downloadingGuid: "",
      importedGuids: [],
      statusText: "",
    };
  }

  componentDidMount() {
    if (this.state.isLoggedIn) {
      this.handleRefreshList();
    }
  }

  applySession = async () => {
    const session = getSession();
    this.setState(
      {
        isLoggedIn: !!session,
        userName: session?.userName || "",
        accountInput: session?.userName || this.state.accountInput,
      },
      () => {
        if (session) {
          this.handleRefreshList();
        }
      }
    );
    if (session) {
      try {
        const profile = await getUserProfile(session);
        if (profile && profile.code > 0) {
          const displayName =
            profile.userName || profile.email || profile.nickName || "";
          if (displayName) {
            this.setState({ userName: displayName });
          }
        }
      } catch (error) {
        // 画像接口失败不影响书库使用
      }
    }
  };

  handleLogin = async () => {
    const { accountInput, passwordInput } = this.state;
    if (!accountInput.trim() || !passwordInput) {
      toast.error(this.props.t("Please enter your NeatReader account and password"));
      return;
    }
    this.setState({ isLoggingIn: true, statusText: this.props.t("Signing in...") });
    try {
      await loginWithPassword(accountInput.trim(), passwordInput);
      this.setState({ passwordInput: "" });
      toast.success(this.props.t("Login successful"));
      await this.applySession();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      this.setState({ statusText: "" });
    } finally {
      this.setState({ isLoggingIn: false });
    }
  };

  handleTokenLogin = async () => {
    const token = this.state.tokenInput.trim();
    if (!token) {
      toast.error(this.props.t("Please enter the NeatReader token"));
      return;
    }
    this.setState({ isLoggingIn: true, statusText: this.props.t("Signing in...") });
    try {
      await loginWithToken(token, this.state.accountInput.trim());
      this.setState({ tokenInput: "" });
      toast.success(this.props.t("Login successful"));
      await this.applySession();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      this.setState({ statusText: "" });
    } finally {
      this.setState({ isLoggingIn: false });
    }
  };

  handleLogout = () => {
    clearSession();
    this.setState({
      isLoggedIn: false,
      userName: "",
      passwordInput: "",
      tokenInput: "",
      cloudBooks: [],
      cloudSize: 0,
      cloudBookNum: 0,
      statusText: "",
      importedGuids: [],
    });
    toast.success(this.props.t("Log out successful"));
  };

  handleRefreshList = async () => {
    if (!this.state.isLoggedIn) return;
    this.setState({ isLoadingList: true, statusText: this.props.t("Loading cloud books...") });
    try {
      const result = await getCloudBookList();
      this.setState({
        cloudBooks: result.bookList.sort(
          (a, b) => (b.addTime || 0) - (a.addTime || 0)
        ),
        cloudSize: result.cloudSize || 0,
        cloudBookNum: result.cloudBookNum || result.bookList.length,
        statusText: "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      this.setState({ statusText: message });
      if (message.indexOf("token") > -1 || message.indexOf("登录") > -1) {
        // 凭据失效时保留会话，只提示用户重新登录
      }
    } finally {
      this.setState({ isLoadingList: false });
    }
  };

  handleDownload = async (book: NeatReaderCloudBook) => {
    if (this.state.downloadingGuid) return;
    if (this.state.importedGuids.indexOf(book.guid) > -1) {
      toast(this.props.t("This book has been imported"));
      return;
    }
    this.setState({ downloadingGuid: book.guid });
    await importNeatReaderBook(book);
    this.setState((prev) => ({
      downloadingGuid: "",
      importedGuids: prev.importedGuids.concat(book.guid),
    }));
    this.props.handleFetchBooks();
  };

  handleDownloadAll = async () => {
    if (this.state.isDownloadingAll || this.state.downloadingGuid) return;
    const pending = this.state.cloudBooks.filter(
      (book) => this.state.importedGuids.indexOf(book.guid) === -1
    );
    if (pending.length === 0) {
      toast(this.props.t("No book to download"));
      return;
    }
    this.setState({ isDownloadingAll: true });
    for (const book of pending) {
      this.setState({ downloadingGuid: book.guid });
      const result = await importNeatReaderBook(book);
      this.setState((prev) => ({
        importedGuids: prev.importedGuids.concat(book.guid),
      }));
      if (result.book) {
        this.props.handleFetchBooks();
      }
    }
    this.setState({ isDownloadingAll: false, downloadingGuid: "" });
  };

  getCoverUrl = (book: NeatReaderCloudBook) => {
    if (book.bookCover && book.bookCover.startsWith("http")) {
      return book.bookCover.replace(/^http:/, "https:");
    }
    return `${NEATREADER_COVER_HOST}/${book.guid}-cover`;
  };

  formatBookSize = (size?: number) => {
    if (!size || size <= 0) return "-";
    return formatCloudSize(size);
  };

  formatAddTime = (time?: number) => {
    if (!time) return "";
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  };

  renderLoginBox = () => {
    return (
      <div className="neatreader-panel">
        <div className="neatreader-panel-title">
          <Trans>NeatReader cloud library</Trans>
        </div>
        <p className="neatreader-panel-desc">
          <Trans>
            Sign in with your NeatReader account to list the books stored in the
            NeatReader cloud, then download them into this library with one
            click.
          </Trans>
        </p>
        <div className="neatreader-form">
          <div className="neatreader-field">
            <label>
              <Trans>Account</Trans>
            </label>
            <input
              className="neatreader-input"
              type="text"
              value={this.state.accountInput}
              placeholder={this.props.t("Email of your NeatReader account")}
              onChange={(event) =>
                this.setState({ accountInput: event.target.value })
              }
            />
          </div>
          <div className="neatreader-field">
            <label>
              <Trans>Password</Trans>
            </label>
            <input
              className="neatreader-input"
              type="password"
              value={this.state.passwordInput}
              placeholder={this.props.t("Password")}
              onChange={(event) =>
                this.setState({ passwordInput: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  this.handleLogin();
                }
              }}
            />
          </div>
          <button
            className="neatreader-btn primary"
            disabled={this.state.isLoggingIn}
            onClick={this.handleLogin}
          >
            {this.state.isLoggingIn ? (
              <Trans>Signing in...</Trans>
            ) : (
              <Trans>Sign in</Trans>
            )}
          </button>
        </div>
        <div className="neatreader-divider">
          <span>
            <Trans>or sign in with token</Trans>
          </span>
        </div>
        <div className="neatreader-form">
          <div className="neatreader-field">
            <label>
              <Trans>Token</Trans>
            </label>
            <input
              className="neatreader-input"
              type="text"
              value={this.state.tokenInput}
              placeholder={this.props.t(
                "Token from the NeatReader website cookie"
              )}
              onChange={(event) =>
                this.setState({ tokenInput: event.target.value })
              }
            />
          </div>
          <button
            className="neatreader-btn"
            disabled={this.state.isLoggingIn}
            onClick={this.handleTokenLogin}
          >
            <Trans>Sign in with token</Trans>
          </button>
        </div>
        {this.state.statusText && (
          <p className="neatreader-status">{this.state.statusText}</p>
        )}
      </div>
    );
  };

  renderAccountBox = () => {
    return (
      <div className="neatreader-account">
        <div className="neatreader-account-info">
          <span className="icon-user neatreader-account-icon"></span>
          <div className="neatreader-account-text">
            <div className="neatreader-account-name">
              {this.state.userName || this.props.t("NeatReader account")}
            </div>
            <div className="neatreader-account-desc">
              <Trans>Cloud books</Trans>: {this.state.cloudBookNum || 0} ·{" "}
              {formatCloudSize(this.state.cloudSize)}
            </div>
          </div>
        </div>
        <div className="neatreader-account-actions">
          <button
            className="neatreader-btn"
            disabled={this.state.isLoadingList}
            onClick={this.handleRefreshList}
          >
            <Trans>Refresh</Trans>
          </button>
          <button
            className="neatreader-btn"
            disabled={
              this.state.isLoadingList ||
              this.state.isDownloadingAll ||
              !!this.state.downloadingGuid
            }
            onClick={this.handleDownloadAll}
          >
            {this.state.isDownloadingAll ? (
              <Trans>Downloading...</Trans>
            ) : (
              <Trans>Download all</Trans>
            )}
          </button>
          <button className="neatreader-btn" onClick={this.handleLogout}>
            <Trans>Sign out</Trans>
          </button>
        </div>
      </div>
    );
  };

  renderBookList = () => {
    const { cloudBooks, isLoadingList } = this.state;
    if (!this.state.isLoggedIn) return null;
    if (isLoadingList && cloudBooks.length === 0) {
      return (
        <div className="neatreader-empty">
          <span className="icon-loading neatreader-loading"></span>
          <span>
            <Trans>Loading cloud books...</Trans>
          </span>
        </div>
      );
    }
    if (cloudBooks.length === 0) {
      return (
        <div className="neatreader-empty">
          <Trans>No book in NeatReader cloud</Trans>
        </div>
      );
    }
    return (
      <div className="neatreader-book-list">
        {cloudBooks.map((book) => {
          const isImporting = this.state.downloadingGuid === book.guid;
          const isImported =
            this.state.importedGuids.indexOf(book.guid) > -1;
          return (
            <div className="neatreader-book-item" key={book.guid}>
              <div className="neatreader-book-cover">
                <img
                  src={this.getCoverUrl(book)}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <div className="neatreader-book-info">
                <div className="neatreader-book-name">
                  {book.bookName || book.fileName || book.guid}
                </div>
                <div className="neatreader-book-meta">
                  <span>{this.formatBookSize(book.fileSize)}</span>
                  {(book.fileType || "").toUpperCase() !== "" && (
                    <span>{(book.fileType || "").toUpperCase()}</span>
                  )}
                  {this.formatAddTime(book.addTime) && (
                    <span>{this.formatAddTime(book.addTime)}</span>
                  )}
                </div>
              </div>
              <button
                className="neatreader-btn small"
                disabled={
                  isImporting ||
                  this.state.isDownloadingAll ||
                  isImported
                }
                onClick={() => this.handleDownload(book)}
              >
                {isImporting ? (
                  <Trans>Downloading...</Trans>
                ) : isImported ? (
                  <Trans>Imported</Trans>
                ) : (
                  <Trans>Download</Trans>
                )}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  render() {
    return (
      <div className="neatreader-setting-container">
        {this.state.isLoggedIn ? this.renderAccountBox() : this.renderLoginBox()}
        {this.renderBookList()}
      </div>
    );
  }
}

export default NeatReaderSetting;
