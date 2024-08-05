const SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb';
const PUBLIC_CHAR_UUID = '00001234-0000-1000-8000-00805f9b34fb';

interface MessageBase {
    type: string;
    sourceAddress: string;
    destinationAddress: string;
    requestUUID: string;
}

interface AccessOnOff extends MessageBase {
    list: { [mac: string]: boolean };
}

interface AccessOnOFFSingle extends MessageBase {
    pair: { [mac: string]: boolean };
}

interface GetDeviceList extends MessageBase {}

interface ResOk extends MessageBase {
    status: boolean;
}

const scanButton = document.getElementById('scan-button')!;
const deviceList = document.getElementById('device-list')!;
const controlList = document.getElementById('control-list')!;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const cmpUUD = (a: string, b: string) => a.replace(/[^a-zA-Z0-9 ]/g, "") === b.replace(/[^a-zA-Z0-9 ]/g, "");

let uniqueCharacteristic: any;

scanButton.addEventListener('click', async () => {
    if (!navigator.bluetooth) {
        console.error('Web Bluetooth API is not available in this browser.');
        return;
    }

    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [SERVICE_UUID]
        });

        displayDeviceList(device);
    } catch (error) {
        console.error('Error:', error);
    }
});

function displayDeviceList(device: BluetoothDevice) {
    deviceList.innerHTML = '';
    const listItem = document.createElement('li');
    listItem.textContent = device.name || device.id;
    listItem.addEventListener('click', () => connectToDevice(device));
    deviceList.appendChild(listItem);
}

async function connectToDevice(device: BluetoothDevice) {
    let retryCount = 0;
    const maxRetries = 6;
    let connected = false;

    while (!connected && retryCount < maxRetries) {
        try {
            console.log('Connecting to device:', device);
            const server = await device.gatt!.connect();

            if (!server) {
                throw new Error('Unable to connect to GATT server');
            }

            console.log('Connected to GATT server:', server);
	    console.log('is Connected = ', server.connected );

            const services = await server.getPrimaryServices();
            console.log ('Services...', services);
            console.log('Found services:', services.map(service => service.uuid));

            let publicService = services.find(service => cmpUUD(service.uuid, SERVICE_UUID));

            if (!publicService) {
                throw new Error('Public service not found');
            }

            console.log('Found public service:', publicService);

            const characteristics = await publicService.getCharacteristics();
            console.log('Found characteristics:', characteristics.map(char => char.uuid));

            let publicCharacteristic = characteristics.find(characteristic => cmpUUD(characteristic.uuid, PUBLIC_CHAR_UUID));

            if (!publicCharacteristic) {
                throw new Error('Public characteristic not found');
            }

            console.log('Found public characteristic:', publicCharacteristic);

            const value = await publicCharacteristic.readValue();
            const decoder = new TextDecoder('utf-8');
            const data = decoder.decode(value);

            console.log('Public characteristic value:', data);

            uniqueCharacteristic = characteristics.find(char => cmpUUD(char.uuid, data));
            if (uniqueCharacteristic) {
                uniqueCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);
                await uniqueCharacteristic.startNotifications();
	        console.log('Found unique characteristic');
            }
	    else
	    {
		throw new Error ('Unique characteristic not found');
	    }

            if (uniqueCharacteristic) {
                const getMacList: GetDeviceList = {
                    type: 'GetDeviceList',
                    sourceAddress: '00:00:00:00:00:00',
                    destinationAddress: device.name,//id,
                    requestUUID: 'M1'
                };
                //await 
                sendMessage(uniqueCharacteristic, getMacList);
            }

            connected = true;
        } catch (error) {
            retryCount++;
            console.error(`Error: ${error}. Retry ${retryCount}/${maxRetries}`);
            await wait(1000); // Wait 1 second before retrying
        }
    }

    if (!connected) {
        console.error('Failed to connect to device after multiple attempts');
    }
}

let destAdr = '';
let srcAdr = '';
let receivedData = '';
function handleNotifications(event: Event) {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    const decoder = new TextDecoder('utf-8');
    const data = decoder.decode(value!);

    receivedData += data;
    console.log('handleNotifications');
    console.log(receivedData);

    try {
        const message: AccessOnOff = JSON.parse(receivedData);
        if (message.type === 'AccessOnOff') {
            displayControlList(message.list);
            receivedData = ''; // Reset buffer
	    console.log('on of parsed');
	    destAdr = message.sourceAddress;
	    srcAdr = message.destinationAddress;
	    console.log (message);
        }
    } catch (e) {
        // Not a complete JSON message yet
	    console.log('on of parse error!');
    }
}

function displayControlList(devices: { [mac: string]: boolean }) {
    controlList.innerHTML = '';
    for (const [mac, isEnabled] of Object.entries(devices)) {
        const listItem = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isEnabled;
        checkbox.addEventListener('change', () => handleCheckboxChange(mac, checkbox.checked));
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(mac));
        listItem.appendChild(label);
        controlList.appendChild(listItem);
    }
}

async function handleCheckboxChange(mac: string, isEnabled: boolean) {
    if (!uniqueCharacteristic) return;

    const message: AccessOnOFFSingle = {
        type: 'AccessOnOFFSingle',
        sourceAddress: srcAdr,
        destinationAddress: destAdr,////mac,
        requestUUID: 'M2',
        pair: { [mac]: isEnabled }
    };

    await sendMessage(uniqueCharacteristic, message);
}

async function sendMessage(characteristic: any, message: MessageBase) {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(message));

    const maxChunkSize = 160;
    for (let i = 0; i < data.length; i += maxChunkSize) {
        const chunk = data.slice(i, i + maxChunkSize);
        await characteristic.writeValue(chunk);
        await wait(10);
    }
}