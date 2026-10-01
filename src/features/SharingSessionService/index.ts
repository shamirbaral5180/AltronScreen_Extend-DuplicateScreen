import uuid from 'uuid';
import RoomIDService from '../../server/RoomIDService';
import { ConnectedDevicesService } from '../ConnectedDevicesService';
import RendererWebrtcHelpersService from '../PeerConnectionHelperRendererService';
import SharingSession from './SharingSession';
import SharingSessionStatusEnum from './SharingSessionStatusEnum';
import { LocalPeerUser } from '../../common/LocalPeerUser';
import { MAX_VIEWER_SESSIONS } from '../../common/config';

export default class SharingSessionService {
	user: LocalPeerUser | null;
	sharingSessions: Map<string, SharingSession>;
	waitingForConnectionSharingSession: SharingSession | null;
	roomIDService: RoomIDService;
	connectedDevicesService: ConnectedDevicesService;
	rendererWebrtcHelpersService: RendererWebrtcHelpersService;

	constructor(
		_roomIDService: RoomIDService,
		_connectedDevicesService: ConnectedDevicesService,
		_rendererWebrtcHelpersService: RendererWebrtcHelpersService,
	) {
		this.roomIDService = _roomIDService;
		this.connectedDevicesService = _connectedDevicesService;
		this.rendererWebrtcHelpersService = _rendererWebrtcHelpersService;
		this.waitingForConnectionSharingSession = null;
		this.sharingSessions = new Map<string, SharingSession>();
		this.user = null;
		this.createUser();

		setInterval(
			() => {
				this.pollForInactiveSessions();
			},
			1000 * 60 * 60,
		); // every hour
	}

	createUser(): Promise<undefined> {
		return new Promise((resolve) => {
			if (process.env.RUN_MODE === 'test') resolve(undefined);
			const username = uuid.v4();
			const id = uuid.v4();

			this.user = {
				username,
				id,
			};
			resolve(undefined);
		});
	}

	async createNewSharingSession(_roomID: string): Promise<SharingSession> {
		await this.waitWhileUserIsNotCreated();
		if (this.sharingSessions.size >= MAX_VIEWER_SESSIONS)
			throw new Error('Maximum simultaneous viewer sessions reached');
		const roomID = _roomID || uuid.v4();
		this.roomIDService.markRoomIDAsTaken(roomID);
		const sharingSession = new SharingSession(
			roomID,
			this.user as LocalPeerUser,
			this.rendererWebrtcHelpersService,
		);
		this.sharingSessions.set(sharingSession.id, sharingSession);
		return sharingSession;
	}

	pollForInactiveSessions(): void {
		[...this.sharingSessions.keys()].forEach((key) => {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			const { status } = this.sharingSessions.get(key);
			if (
				status === SharingSessionStatusEnum.ERROR ||
				status === SharingSessionStatusEnum.DESTROYED
			) {
				this.sharingSessions.delete(key);
			}
		});
	}

	waitWhileUserIsNotCreated(): Promise<undefined> {
		if (this.user !== null) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			const currentInterval = setInterval(() => {
				if (this.user !== null) {
					resolve(undefined);
					clearInterval(currentInterval);
				}
			}, 1000);
		});
	}
}
