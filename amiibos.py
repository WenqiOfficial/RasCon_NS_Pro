import os
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_file_path(filename):
    return os.path.join(BASE_DIR, 'file', filename)

def get_amiibo_path(filename=None):
    if filename:
        return os.path.join(BASE_DIR, 'file', 'amiibo', filename)
    else:
        return os.path.join(BASE_DIR, 'file', 'amiibo')

def unzip(zipFile):

    print('开始解压'+zipFile)

    amiibo_dir = get_amiibo_path()
    zip_path = get_amiibo_path(zipFile)
    
    with zipfile.ZipFile(zip_path, "r") as zFile:
        for file in zFile.namelist():

            if '.' in file and file.rsplit('.', 1)[1].lower() in {'bin','BIN'}:
                zFile.extract(file, amiibo_dir)

                #文件名 空格改为_，并且改为小写
                oldName = os.path.join(amiibo_dir, file)
                newName = os.path.join(amiibo_dir, file.replace(' ','_').lower())
                if oldName != newName:
                    os.rename(oldName,newName)

    if os.path.exists(zip_path):
        os.remove(zip_path) # 删除压缩包

    print('解压完毕，'+zipFile+'已删除')

def save(cmd):

    msg ='\n'

    for _ in cmd:
        msg += _


    path = get_file_path('scriptcopy.txt')
    with open(path,'w') as f:
        f.write(msg)

def sendCMD(cmd):
    return cmd+'\n'
def readAmiibo():

    cmd = list()

 #   print('开始读取全部的amiibo')

    path = get_amiibo_path()

    fileList=os.listdir(path)

    cmd.append(sendCMD('DOWN'))
    cmd.append(sendCMD('2000'))

    for amiibo in fileList:
        if amiibo.rsplit('.', 1)[1].lower() == 'bin':

            cmd.append(sendCMD('Y'))
            cmd.append(sendCMD('amiibo '+amiibo))
            cmd.append(sendCMD('FOR 4'))
            cmd.append(sendCMD('A'))
            cmd.append(sendCMD('1000'))
            cmd.append(sendCMD('NEXT'))


#    print('amiibo全部读取完毕')
    cmd.append(sendCMD('B'))
    cmd.append(sendCMD('2000'))
    cmd.append(sendCMD('B'))
    
    return cmd

def run(zipName):

    #解压上传的压缩包
    unzip(zipName)
                                                                                                                                                                                                 #批量读取amiibo
    a = readAmiibo()

    save(a)

