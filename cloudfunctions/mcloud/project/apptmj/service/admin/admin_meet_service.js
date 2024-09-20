/**
 * Notes: 预约后台管理
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-12-08 07:48:00 
 */

const BaseProjectAdminService = require('./base_project_admin_service.js');
const MeetService = require('../meet_service.js');
const AdminHomeService = require('../admin/admin_home_service.js');
const dataUtil = require('../../../../framework/utils/data_util.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const setupUtil = require('../../../../framework/utils/setup/setup_util.js');
const util = require('../../../../framework/utils/util.js');
const cloudUtil = require('../../../../framework/cloud/cloud_util.js');
const cloudBase = require('../../../../framework/cloud/cloud_base.js');
const md5Lib = require('../../../../framework/lib/md5_lib.js');

const MeetModel = require('../../model/meet_model.js');
const JoinModel = require('../../model/join_model.js');
const DayModel = require('../../model/day_model.js');
const TempModel = require('../../model/temp_model.js');

const exportUtil = require('../../../../framework/utils/export_util.js');


// 导出报名数据KEY
const EXPORT_JOIN_DATA_KEY = 'EXPORT_JOIN_DATA';

class AdminMeetService extends BaseProjectAdminService {




	/** 预约数据列表 */
	async getDayList(meetId, start, end) {
		let where = {
			DAY_MEET_ID: meetId,
			day: ['between', start, end]
		}
		let orderBy = {
			day: 'asc'
		}
		return await DayModel.getAllBig(where, 'day,times,dayDesc', orderBy);
	}

	// 按项目统计人数
	async statJoinCntByMeet(meetId) {
		let where = {
			JOIN_MEET_ID: meetId
		};
		let ret = await JoinModel.groupCount(where, 'JOIN_STATUS');
		
		return {
			succCnt: ret['JOIN_STATUS_1'] || 0,
			cancelCnt: ret['JOIN_STATUS_10'] || 0,
			adminCancelCnt: ret['JOIN_STATUS_99'] || 0
		};
	}

	/** 管理员按钮核销 */
	async checkinJoin(joinId, flag) {
		let join = await JoinModel.getOne({ _id: joinId });
		if (!join) {
			this.AppError('预约记录不存在');
		}

		let data = {
			JOIN_STATUS: flag ? JoinModel.STATUS.SUCC : JoinModel.STATUS.CANCEL,
			JOIN_IS_CHECKIN: flag ? 1 : 0
		};

		await JoinModel.edit({ _id: joinId }, data);

		return { result: 'ok' };
	}

	/** 管理员扫码核销 */
	async scanJoin(meetId, code) {
		let where = {
			JOIN_MEET_ID: meetId,
			JOIN_CODE: code
		};
		let join = await JoinModel.getOne(where);
		if (!join) {
			this.AppError('预约记录不存在');
		}

		let data = {
			JOIN_STATUS: JoinModel.STATUS.SUCC,
			JOIN_IS_CHECKIN: 1
		};

		await JoinModel.edit(where, data);

		return { result: 'ok' };
	}

	/**
	 * 判断本日是否有预约记录
	 * @param {*} daySet daysSet的节点
	 */
	checkHasJoinCnt(times) {
		if (!times) return false;
		for (let k = 0; k < times.length; k++) {
			if (times[k].stat.succCnt) return true;
		}
		return false;
	}

	// 判断含有预约的日期
	getCanModifyDaysSet(daysSet) {
		let now = timeUtil.time('Y-M-D');

		for (let k = 0; k < daysSet.length; k++) {
			if (daysSet[k].day < now) continue;
			daysSet[k].hasJoin = this.checkHasJoinCnt(daysSet[k].times);
		}

		return daysSet;
	}

	/** 取消某个时间段的所有预约记录 */
	async cancelJoinByTimeMark(meetId, timeMark, reason) {
		let where = {
			JOIN_MEET_ID: meetId,
			JOIN_MEET_TIME_MARK: timeMark,
			JOIN_STATUS: JoinModel.STATUS.SUCC
		};
		
		let data = {
			JOIN_STATUS: JoinModel.STATUS.ADMIN_CANCEL,
			JOIN_CANCEL_TIME: this._timestamp,
			JOIN_REASON: reason
		};
		
		await JoinModel.edit(where, data);
		
		// 更新统计
		await this.statJoinCnt(meetId, timeMark);
	}

	// 更新forms信息
	async updateMeetForms({
		id,
		hasImageForms
	}) {
		let meet = await MeetModel.getOne({_id: id});
		if (!meet) {
			this.AppError('未找到该预约');
		}

		let forms = meet.MEET_FORMS;
		for (let i = 0; i < forms.length; i++) {
			if (hasImageForms.includes(forms[i].type)) {
				forms[i].type = 'image';
			}
		}

		await MeetModel.edit({_id: id}, {MEET_FORMS: forms});
	}

	/**添加 */
	async insertMeet(adminId, {
		title,
		order,
		cancelSet,
		cateId,
		cateName,
		daysSet,
		forms,
		joinForms,
	}) {
		let data = {
			MEET_TITLE: title,
			MEET_ORDER: order,
			MEET_CANCEL_SET: cancelSet,
			MEET_CATE_ID: cateId,
			MEET_CATE_NAME: cateName,
			MEET_DAYS: daysSet.length,
			MEET_ADMIN_ID: adminId,
			MEET_FORMS: forms,
			MEET_JOIN_FORMS: joinForms,
			MEET_STATUS: 1,
			MEET_ADD_TIME: this._timestamp,
			MEET_EDIT_TIME: this._timestamp
		};

		let id = await MeetModel.insert(data);

		// 创建每个日期的记录
		for (let k = 0; k < daysSet.length; k++) {
			let daySet = daysSet[k];
			let dayData = {
				DAY_MEET_ID: id,
				day: daySet.day,
				dayDesc: daySet.dayDesc,
				times: daySet.times
			};
			await DayModel.insert(dayData);
		}

		return {
			id
		};
	}

	/**排期设置 */
	async setDays(id, {
		daysSet,
	}) {
		let meet = await MeetModel.getOne({_id: id});
		if (!meet) {
			this.AppError('未找到该预约');
		}

		// 先删除原有的日期设置
		await DayModel.del({DAY_MEET_ID: id});

		// 创建新的日期设置
		for (let k = 0; k < daysSet.length; k++) {
			let daySet = daysSet[k];
			let dayData = {
				DAY_MEET_ID: id,
				day: daySet.day,
				dayDesc: daySet.dayDesc,
				times: daySet.times
			};
			await DayModel.insert(dayData);
		}

		// 更新预约的日期数量
		await MeetModel.edit({_id: id}, {MEET_DAYS: daysSet.length, MEET_EDIT_TIME: this._timestamp});
	}

	/**删除数据 */
	async delMeet(id) {
		await MeetModel.del({_id: id});
		await DayModel.del({DAY_MEET_ID: id});
		await JoinModel.del({JOIN_MEET_ID: id});
	}

	/**获取信息 */
	async getMeetDetail(id) {
		let fields = '*';

		let where = {
			_id: id
		}
		let meet = await MeetModel.getOne(where, fields);
		if (!meet) return null;

		let meetService = new MeetService();
		meet.MEET_DAYS_SET = await meetService.getDaysSet(id, timeUtil.time('Y-M-D')); //今天及以后

		return meet;
	}


	/** 更新日期设置 */
	async _editDays(meetId, nowDay, daysSetData) {
		// 删除旧的日期设置
		await DayModel.del({DAY_MEET_ID: meetId, day: ['>=', nowDay]});

		// 添加新的日期设置
		for (let k = 0; k < daysSetData.length; k++) {
			let daySet = daysSetData[k];
			let dayData = {
				DAY_MEET_ID: meetId,
				day: daySet.day,
				dayDesc: daySet.dayDesc,
				times: daySet.times
			};
			await DayModel.insert(dayData);
		}
	}

	/**更新数据 */
	async editMeet({
		id,
		title,
		cateId,
		cateName,
		order,
		cancelSet,
		daysSet,
		forms,
		joinForms
	}) {
		let data = {
			MEET_TITLE: title,
			MEET_CATE_ID: cateId,
			MEET_CATE_NAME: cateName,
			MEET_ORDER: order,
			MEET_CANCEL_SET: cancelSet,
			MEET_DAYS: daysSet.length,
			MEET_FORMS: forms,
			MEET_JOIN_FORMS: joinForms,
			MEET_EDIT_TIME: this._timestamp
		};

		await MeetModel.edit({_id: id}, data);

		// 更新日期设置
		await this._editDays(id, timeUtil.time('Y-M-D'), daysSet);
	}

	/**预约名单分页列表 */
	async getJoinList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		meetId,
		mark,
		page,
		size,
		isTotal = true,
		oldTotal
	}) {

		orderBy = orderBy || {
			'JOIN_ADD_TIME': 'desc'
		};
		let fields = 'JOIN_IS_CHECKIN,JOIN_CHECKIN_TIME,JOIN_CODE,JOIN_ID,JOIN_REASON,JOIN_USER_ID,JOIN_MEET_ID,JOIN_MEET_TITLE,JOIN_MEET_DAY,JOIN_MEET_TIME_START,JOIN_MEET_TIME_END,JOIN_MEET_TIME_MARK,JOIN_FORMS,JOIN_STATUS,JOIN_ADD_TIME';

		let where = {
			JOIN_MEET_ID: meetId,
			JOIN_MEET_TIME_MARK: mark
		};
		if (util.isDefined(search) && search) {
			where['JOIN_FORMS.val'] = {
				$regex: '.*' + search,
				$options: 'i'
			};
		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'status':
					// 按类型
					sortVal = Number(sortVal);
					if (sortVal == 1099) //取消的2种
						where.JOIN_STATUS = ['in', [10, 99]]
					else
						where.JOIN_STATUS = Number(sortVal);
					break;
				case 'checkin':
					// 核销
					where.JOIN_STATUS = JoinModel.STATUS.SUCC;
					if (sortVal == 1) {
						where.JOIN_IS_CHECKIN = 1;
					} else {
						where.JOIN_IS_CHECKIN = 0;
					}
					break;
			}
		}

		return await JoinModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/**预约项目分页列表 */
	async getAdminMeetList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件
		page,
		size,
		isTotal = true,
		oldTotal
	}) {

		orderBy = orderBy || {
			'MEET_ORDER': 'asc',
			'MEET_ADD_TIME': 'desc'
		};
		let fields = 'MEET_CATE_ID,MEET_CATE_NAME,MEET_TITLE,MEET_STATUS,MEET_DAYS,MEET_ADD_TIME,MEET_EDIT_TIME,MEET_ORDER,MEET_VOUCH,MEET_QR';

		let where = {};
		if (util.isDefined(search) && search) {
			where.MEET_TITLE = {
				$regex: '.*' + search,
				$options: 'i'
			};
		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'status': {
					// 按类型
					where.MEET_STATUS = Number(sortVal);
					break;
				}
				case 'cateId': {
					// 按类型
					where.MEET_CATE_ID = sortVal;
					break;
				}
				case 'vouch': {
					where.MEET_VOUCH = 1;
					break;
				}
				case 'top': {
					where.MEET_ORDER = 0;
					break;
				}
			}
		}

		return await MeetModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 删除 */
	async delJoin(joinId) {
		await JoinModel.del({_id: joinId});
	}

	/**修改报名状态 
	 * 特殊约定 99=>正常取消 
	 */
	async statusJoin(joinId, status, reason = '') {
		let join = await JoinModel.getOne({_id: joinId});
		if (!join) {
			this.AppError('未找到该预约记录');
		}

		let data = {
			JOIN_STATUS: status,
			JOIN_EDIT_TIME: this._timestamp
		};

		if (status == JoinModel.STATUS.ADMIN_CANCEL) {
			data.JOIN_REASON = reason;
			data.JOIN_CANCEL_TIME = this._timestamp;
		}

		await JoinModel.edit({_id: joinId}, data);

		// 更新统计
		await this.statJoinCnt(join.JOIN_MEET_ID, join.JOIN_MEET_TIME_MARK);
	}

	/**修改项目状态 */
	async statusMeet(id, status) {
		let data = {
			MEET_STATUS: status,
			MEET_EDIT_TIME: this._timestamp
		};
		await MeetModel.edit({_id: id}, data);
	}

	/**置顶排序设定 */
	async sortMeet(id, sort) {
		let data = {
			MEET_ORDER: sort,
			MEET_EDIT_TIME: this._timestamp
		};
		await MeetModel.edit({_id: id}, data);
	}

	/**首页设定 */
	async vouchMeet(id, vouch) {
		let data = {
			MEET_VOUCH: vouch,
			MEET_EDIT_TIME: this._timestamp
		};
		await MeetModel.edit({_id: id}, data);
	}

	//##################模板
	/**添加模板 */
	async insertMeetTemp({
		name,
		times,
	}, meetId = 'admin') {
		let data = {
			TEMP_NAME: name,
			TEMP_TIMES: times,
			TEMP_MEET_ID: meetId,
			TEMP_ADD_TIME: this._timestamp
		};
		await TempModel.insert(data);
	}

	/**更新数据 */
	async editMeetTemp({
		id,
		limit,
		isLimit
	}, meetId = 'admin') {
		let data = {
			TEMP_LIMIT: limit,
			TEMP_IS_LIMIT: isLimit,
			TEMP_EDIT_TIME: this._timestamp
		};
		await TempModel.edit({_id: id, TEMP_MEET_ID: meetId}, data);
	}


	/**删除数据 */
	async delMeetTemp(id, meetId = 'admin') {
		await TempModel.del({_id: id, TEMP_MEET_ID: meetId});
	}


	/**模板列表 */
	async getMeetTempList(meetId = 'admin') {
		let orderBy = {
			'TEMP_ADD_TIME': 'desc'
		};
		let fields = 'TEMP_NAME,TEMP_TIMES';

		let where = {
			TEMP_MEET_ID: meetId
		};
		return await TempModel.getAll(where, fields, orderBy);
	}

	// #####################导出报名数据
	/**获取报名数据 */
	async getJoinDataURL() {
		return await exportUtil.getExportDataURL(EXPORT_JOIN_DATA_KEY);
	}

	/**删除报名数据 */
	async deleteJoinDataExcel() {
		return await exportUtil.deleteDataExcel(EXPORT_JOIN_DATA_KEY);
	}

	/**导出报名数据 */
	async exportJoinDataExcel({
		meetId,
		startDay,
		endDay,
		status
	}) {
		let where = {
			JOIN_MEET_ID: meetId,
			JOIN_MEET_DAY: ['between', startDay, endDay]
		};

		if (util.isDefined(status) && status != 'all') {
			where.JOIN_STATUS = Number(status);
		}

		let orderBy = {
			JOIN_MEET_DAY: 'asc',
			JOIN_MEET_TIME_START: 'asc',
			JOIN_ADD_TIME: 'asc'
		};

		let joins = await JoinModel.getAll(where, '*', orderBy);

		let data = [];
		for (let k = 0; k < joins.length; k++) {
			let join = joins[k];
			let line = [
				join.JOIN_MEET_DAY,
				join.JOIN_MEET_TIME_START,
				join.JOIN_MEET_TITLE,
				join.JOIN_STATUS == JoinModel.STATUS.SUCC ? '预约成功' : '已取消',
				...join.JOIN_FORMS.map(f => f.val)
			];
			data.push(line);
		}

		let fileName = '预约名单' + startDay + '-' + endDay + '.xlsx';

		let xlsxData = await exportUtil.dataToExcel(fileName, data);

		return {
			filename: fileName,
			data: xlsxData
		};
	}

}

module.exports = AdminMeetService;