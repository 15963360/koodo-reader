import { connect } from "react-redux";
import NeatReaderSetting from "./component";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { stateType } from "../../../store";
import { handleFetchBooks } from "../../../store/actions";

const mapStateToProps = (state: stateType) => {
  return {
    isAuthed: state.manager.isAuthed,
  };
};
const actionCreator = { handleFetchBooks };
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(NeatReaderSetting as any) as any) as any);
