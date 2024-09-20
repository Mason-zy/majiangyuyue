/**
 * Notes: 用户管理
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2022-01-22  07:48:00 
 */

const BaseProjectAdminService = require('./base_project_admin_service.js');

const util = require('../../../../framework/utils/util.js');
const exportUtil = require('../../../../framework/utils/export_util.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const dataUtil = require('../../../../framework/utils/data_util.js');
const UserModel = require('../../model/user_model.js');
const AdminHomeService = require('./admin_home_service.js');
const JoinModel = require('../../model/join_model.js');
const LogModel = require('../../../../framework/platform/model/log_model.js');
const cloudBase = require('../../../../framework/cloud/cloud_base.js');
// 导出用户数据KEY
const EXPORT_USER_DATA_KEY = 'EXPORT_USER_DATA';

class AdminUserService extends BaseProjectAdminService {


	/** 获得某个用户信息 */
	async getUser({
		userId,
		fields = '*'
	}) {
		let where = {
			USER_MINI_OPENID: userId,
		}
		return await UserModel.getOne(where, fields);
	}

	/** 取得用户分页列表 */
	async getUserList({
		search, // 搜条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件 
		page,
		size,
		oldTotal = 0
	}) {

		orderBy = orderBy || {
			USER_ADD_TIME: 'desc'
		};
		let fields = '*';


		let where = {};
		where.and = {
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};

		if (util.isDefined(search) && search) {
			where.or = [{
				USER_NAME: ['like', search]
			},
			{
				USER_MOBILE: ['like', search]
			},
			{
				USER_MEMO: ['like', search]
			},
			];

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'status':
					where.and.USER_STATUS = Number(sortVal);
					break;
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'USER_ADD_TIME');
					break;
					}
			}
		}
		let result = await UserModel.getList(where, fields, orderBy, page, size, true, oldTotal, false);


		// 为导出增加一个参数condition
		result.condition = encodeURIComponent(JSON.stringify(where));

		return result;
	}

	async statusUser(id, status, reason) {
		if (!id) this.AppError('未提供用户id');
		if (typeof status !== 'number') this.AppError('状态必须为数字');

		let user = await UserModel.getOne({ USER_MINI_OPENID: id });
		if (!user) this.AppError('用户不存在');

		let data = {
			USER_STATUS: status
		}

		if (status == UserModel.STATUS.DISABLE) {
			data.USER_CLOSE_REASON = reason;
		}

		await UserModel.edit({ USER_MINI_OPENID: id }, data);

		this.insertLog('修改了用户状态', user, LogModel.TYPE.USER);
	}

	/**删除用户 */
	async delUser(id) {
		if (!id) this.AppError('未提供用户id');

		let user = await UserModel.getOne({ USER_MINI_OPENID: id });
		if (!user) this.AppError('用户不存在');

		await UserModel.del({ USER_MINI_OPENID: id });

		// 删除用户相关数据
		await JoinModel.del({ JOIN_USER_ID: id });
		// 如果有其他与用户相关的数据表,也需要在这里删除

		this.insertLog('删除了用户', user, LogModel.TYPE.USER);
	}

	// #####################导出用户数据

	/**获取用户数据 */
	async getUserDataURL() {
		return await exportUtil.getExportDataURL(EXPORT_USER_DATA_KEY);
	}

	/**删除用户数据 */
	async deleteUserDataExcel() {
		return await exportUtil.deleteDataExcel(EXPORT_USER_DATA_KEY);
	}

	/**导出用户数据 */
	async exportUserDataExcel(condition, fields) {
		try {
			console.log('Exporting user data with encoded condition:', condition);
			
			// 解码 condition
			condition = JSON.parse(decodeURIComponent(condition));
			
			// 确保包含正确的项目 ID
			if (!condition.and) condition.and = {};
			condition.and._pid = this.getProjectId();

			console.log('Decoded condition:', JSON.stringify(condition));
			console.log('Fields:', fields);

			let userList = await UserModel.getAll(condition, fields);

			console.log('User list length:', userList ? userList.length : 0);

			if (!userList || userList.length === 0) {
				this.AppError('没有找到符合条件的用户数据');
			}

			// 定义表头
			let header = ['用户ID', '用户昵称', '手机号', '注册时间', '最后登录时间', '状态', '备注'];

			// 转换数据为二维数组
			let data = [header];
			userList.forEach(user => {
				data.push([
					user.USER_MINI_OPENID,
					user.USER_NAME,
					user.USER_MOBILE || '未绑定',
					timeUtil.timestamp2Time(user.USER_ADD_TIME),
					user.USER_LOGIN_TIME ? timeUtil.timestamp2Time(user.USER_LOGIN_TIME) : '从未登录',
					user.USER_STATUS == 1 ? '正常' : '禁用',
					user.USER_MEMO || ''
				]);
			});

			let fileName = `用户数据_${timeUtil.time('YMD_HIS')}.xlsx`;
			let result = await exportUtil.exportDataExcel(EXPORT_USER_DATA_KEY, '用户数据', data.length - 1, data);

			if (!result || !result.url) {
				this.AppError('文件生成失败');
			}

			return {
				name: fileName,
				url: result.url
			};
		} catch (err) {
			console.error('导出用户数据失败:', err);
			this.AppError('导出用户数据失败: ' + err.message);
		}
	}

}

module.exports = AdminUserService;