import { app } from 'electron';
import { ConnectedDevicesService } from '../../features/ConnectedDevicesService';
import SharingSessionService from '../../features/SharingSessionService';
import RendererWebrtcHelpersService from '../../features/PeerConnectionHelperRendererService';
import RoomIDService from '../../server/RoomIDService';
import DesktopCapturerSources from '../../features/DesktopCapturerSourcesService';
import DesktopCapturerSourcesService from '../../features/DesktopCapturerSourcesService';
import VirtualDisplayService from '../../features/VirtualDisplayService';

export interface AltronScreenGlobal {
	appPath: string;
	rendererWebrtcHelpersService: RendererWebrtcHelpersService;
	roomIDService: RoomIDService;
	connectedDevicesService: ConnectedDevicesService;
	sharingSessionService: SharingSessionService;
	desktopCapturerSourcesService: DesktopCapturerSourcesService;
	virtualDisplayService: VirtualDisplayService;
	pendingDisplaySourceIds: Map<number, string>;
	latestAppVersion: string;
	currentAppVersion: string;
	cliLocalIp?: string;
}

export const initGlobals = (appPath: string, cliLocalIp?: string) => {
	const altronscreenGlobal: AltronScreenGlobal =
		global as unknown as AltronScreenGlobal;

	altronscreenGlobal.appPath = appPath;
	altronscreenGlobal.rendererWebrtcHelpersService =
		new RendererWebrtcHelpersService(appPath);
	altronscreenGlobal.roomIDService = new RoomIDService();
	altronscreenGlobal.connectedDevicesService = new ConnectedDevicesService();
	altronscreenGlobal.sharingSessionService = new SharingSessionService(
		altronscreenGlobal.roomIDService,
		altronscreenGlobal.connectedDevicesService,
		altronscreenGlobal.rendererWebrtcHelpersService,
	);
	altronscreenGlobal.desktopCapturerSourcesService =
		new DesktopCapturerSources();
	altronscreenGlobal.virtualDisplayService = new VirtualDisplayService();
	altronscreenGlobal.pendingDisplaySourceIds = new Map();
	altronscreenGlobal.latestAppVersion = '';
	altronscreenGlobal.currentAppVersion = app.getVersion();
	altronscreenGlobal.cliLocalIp = cliLocalIp;
};
